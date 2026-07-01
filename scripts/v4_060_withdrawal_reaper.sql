-- Reaper for withdrawals stuck in SENDING.
--
-- A withdrawal is claimed REQUESTED -> SENDING (pm_begin_withdrawal_send) before
-- the on-chain payout, then moved to SENT (pm_mark_withdrawal_sent) or FAILED
-- (pm_fail_withdrawal, which re-credits). If the worker crashes / times out in
-- between, the row is stranded in SENDING forever: the processor only picks up
-- REQUESTED rows, so the user's balance stays debited and they are never paid.
--
-- pm_reclaim_stuck_withdrawal returns such a row to REQUESTED so the processor
-- retries it. The CALLER MUST FIRST verify on-chain that no payout landed for
-- this withdrawal AND that the original attempt's blockhash has expired (the
-- reaper route enforces a min-age well past the ~90s blockhash validity, so the
-- stranded attempt can never land later). Only then is requeuing safe from a
-- double-send. If a payout DID land, the caller marks it SENT instead
-- (pm_mark_withdrawal_sent with the discovered signature).

create or replace function public.pm_reclaim_stuck_withdrawal(
  p_withdrawal_id uuid,
  p_processing_nonce text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_withdrawal_id is null then
    raise exception 'MISSING_WITHDRAWAL_ID';
  end if;
  if p_processing_nonce is null or length(trim(p_processing_nonce)) < 8 then
    raise exception 'MISSING_PROCESSING_NONCE';
  end if;

  -- Lock the row and re-check every invariant under the lock to avoid racing a
  -- concurrent mark-sent/fail. Only a row that is still SENDING, matches the
  -- processing nonce, and has NOT been marked sent (tx_sig is null) is eligible.
  select * into v_row
  from public.escrow_withdrawals
  where withdrawal_id = p_withdrawal_id
  for update;

  if v_row.withdrawal_id is null then
    raise exception 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_row.status <> 'SENDING'
     or v_row.processing_nonce is distinct from p_processing_nonce
     or v_row.tx_sig is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_reclaimable', 'status', v_row.status);
  end if;

  update public.escrow_withdrawals
  set status = 'REQUESTED',
      processing_nonce = null,
      processing_at = null,
      error = concat('reclaimed_stuck_send @ ', now()::text)
  where withdrawal_id = p_withdrawal_id
    and processing_nonce = p_processing_nonce
    and status = 'SENDING'
    and tx_sig is null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'race_lost');
  end if;

  return jsonb_build_object('ok', true, 'status', 'REQUESTED', 'withdrawal_id', p_withdrawal_id);
end;
$$;
