-- =============================================================================
-- v4_010_parimutuel.sql
-- Parimutuel KOL prediction market engine (SUPERSEDES the v3_020 CLOB RPCs).
--
-- Design: each outcome (one KOL per round) is an independent binary YES/NO
-- parimutuel pool. Bettors stake custodial collateral into the YES or NO pool.
-- At settlement the winning side splits BOTH pools pro-rata to stake:
--   profit_i        = losing_pool * stake_i / winning_pool
--   fee_i           = fee_exempt_i ? 0 : profit_i * rake_bps/10000
--   payout_i        = stake_i + profit_i - fee_i
-- Solvency is structural: sum of payouts + sum of fees = winning_pool +
-- losing_pool = total collected. The market can NEVER pay more than it took in.
--
-- Per-bet rake (vs pool-level) so the $NOCRY fee waiver applies per holder:
-- holding >= 10,000 $NOCRY at bet time => that bet pays no fee (fee_exempt).
--
-- Dual collateral: every round is denominated in ONE mint (SOL or USDC).
-- Balances are per (user, mint). market_rounds.collateral_mint selects which.
--
-- Reuses market_rounds, outcome_markets, escrow_deposits, escrow_withdrawals,
-- ledger_entries from v3_010/v3_030 and upgrades user_balances to per-mint.
-- Requires update_updated_at_column() (v2_002), users (v2_010), kols (v2_020).
-- Idempotent / safe to re-run.
-- =============================================================================

-- --- Upgrade user_balances to per-mint ((user_pubkey, mint) primary key) ------
alter table public.user_balances add column if not exists mint text not null default 'SOL';

do $$ begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_balances'::regclass and contype = 'p'
      and conname = 'user_balances_pkey'
  ) then
    -- Only safe to repivot the PK while empty (fresh prod DB). Guard on emptiness.
    if (select count(*) from public.user_balances) = 0 then
      alter table public.user_balances drop constraint user_balances_pkey;
      alter table public.user_balances add constraint user_balances_pkey primary key (user_pubkey, mint);
    end if;
  end if;
end $$;

-- ledger audit: record which mint each balance delta was in
alter table public.ledger_entries add column if not exists mint text;

-- --- Bets --------------------------------------------------------------------
create table if not exists public.pm_bets (
  bet_id uuid primary key default gen_random_uuid(),
  round_id text not null references public.market_rounds(round_id) on delete cascade,
  outcome_id uuid not null references public.outcome_markets(outcome_id) on delete cascade,
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  side boolean not null,                         -- true = YES, false = NO
  amount numeric not null,
  mint text not null,                            -- collateral mint (SOL | USDC mint)
  fee_exempt boolean not null default false,     -- snapshotted $NOCRY waiver at bet time
  payout numeric not null default 0,
  fee numeric not null default 0,
  status text not null default 'ACTIVE',         -- ACTIVE | SETTLED | REFUNDED
  idempotency_key text not null,
  created_at timestamp with time zone not null default now(),
  settled_at timestamp with time zone,
  check (amount > 0),
  check (payout >= 0),
  check (fee >= 0),
  check (status in ('ACTIVE','SETTLED','REFUNDED'))
);

alter table public.pm_bets enable row level security;
drop policy if exists "Users can view their own pm_bets" on public.pm_bets;
create policy "Users can view their own pm_bets" on public.pm_bets for select using (false);

create unique index if not exists pm_bets_user_idem_uniq on public.pm_bets(user_pubkey, idempotency_key);
create index if not exists pm_bets_outcome_idx on public.pm_bets(outcome_id);
create index if not exists pm_bets_round_idx on public.pm_bets(round_id);
create index if not exists pm_bets_user_status_idx on public.pm_bets(user_pubkey, status);
create index if not exists pm_bets_outcome_side_status_idx on public.pm_bets(outcome_id, side, status);

-- --- Parimutuel pool columns on outcome_markets ------------------------------
alter table public.outcome_markets add column if not exists yes_pool numeric not null default 0;
alter table public.outcome_markets add column if not exists no_pool numeric not null default 0;
alter table public.outcome_markets add column if not exists yes_bettor_count integer not null default 0;
alter table public.outcome_markets add column if not exists no_bettor_count integer not null default 0;
alter table public.outcome_markets add column if not exists settled_at timestamp with time zone;

do $$ begin
  alter table public.outcome_markets add constraint outcome_markets_yes_pool_nonneg check (yes_pool >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.outcome_markets add constraint outcome_markets_no_pool_nonneg check (no_pool >= 0);
exception when duplicate_object then null; end $$;

-- --- Protocol fees (rake retained in escrow, recorded as owed, per mint) ------
create table if not exists public.pm_protocol_fees (
  fee_id uuid primary key default gen_random_uuid(),
  round_id text not null references public.market_rounds(round_id) on delete cascade,
  outcome_id uuid references public.outcome_markets(outcome_id) on delete set null,
  mint text not null,
  amount numeric not null,
  created_at timestamp with time zone not null default now(),
  check (amount >= 0)
);
alter table public.pm_protocol_fees enable row level security;
drop policy if exists "no public read pm_protocol_fees" on public.pm_protocol_fees;
create policy "no public read pm_protocol_fees" on public.pm_protocol_fees for select using (false);
create index if not exists pm_protocol_fees_round_idx on public.pm_protocol_fees(round_id);

-- helper: upsert a per-mint balance row and add to available
create or replace function public.pm__credit_balance(p_user text, p_mint text, p_delta numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_balances (user_pubkey, mint, available_collateral)
  values (p_user, p_mint, p_delta)
  on conflict (user_pubkey, mint)
  do update set available_collateral = public.user_balances.available_collateral + excluded.available_collateral;
end;
$$;

-- =============================================================================
-- pm_credit_deposit: credit per-mint custodial collateral from a verified
-- on-chain tx. Idempotent on tx_sig (escrow_deposits.tx_sig UNIQUE).
-- =============================================================================
create or replace function public.pm_credit_deposit(
  p_user_pubkey text,
  p_amount numeric,
  p_mint text,
  p_tx_sig text,
  p_round_scope text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_existing uuid;
  v_deposit uuid;
  v_now timestamp with time zone := now();
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then raise exception 'MISSING_USER_PUBKEY'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_mint is null or length(trim(p_mint)) = 0 then raise exception 'MISSING_MINT'; end if;
  if p_tx_sig is null or length(trim(p_tx_sig)) < 20 then raise exception 'MISSING_TX_SIG'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tx_sig));

  select deposit_id into v_existing from public.escrow_deposits where tx_sig = p_tx_sig limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'already_credited', true, 'deposit_id', v_existing);
  end if;

  insert into public.users (wallet_address) values (p_user_pubkey) on conflict (wallet_address) do nothing;

  insert into public.escrow_deposits (user_pubkey, round_scope, amount, mint, tx_sig, status, created_at)
  values (p_user_pubkey, p_round_scope, p_amount, p_mint, p_tx_sig, 'CONFIRMED', v_now)
  returning deposit_id into v_deposit;

  perform public.pm__credit_balance(p_user_pubkey, p_mint, p_amount);

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
  values (concat('deposit:', v_deposit::text), p_user_pubkey, null, p_amount, 0, 0, 'deposit', v_deposit::text, p_mint, v_now)
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'already_credited', false, 'deposit_id', v_deposit, 'amount', p_amount, 'mint', p_mint);
end;
$$;

-- =============================================================================
-- pm_place_bet: stake collateral into a YES/NO pool, in the round's mint.
-- p_fee_exempt is snapshotted from the caller's verified $NOCRY balance.
-- Idempotent on (user_pubkey, idempotency_key). Round OPEN and before lock_ts.
-- =============================================================================
create or replace function public.pm_place_bet(
  p_user_pubkey text,
  p_outcome_id uuid,
  p_side boolean,
  p_amount numeric,
  p_idempotency_key text,
  p_fee_exempt boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_existing record;
  v_outcome record;
  v_mint text;
  v_bet uuid;
  v_now timestamp with time zone := now();
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then raise exception 'MISSING_USER_PUBKEY'; end if;
  if p_outcome_id is null then raise exception 'MISSING_OUTCOME_ID'; end if;
  if p_side is null then raise exception 'MISSING_SIDE'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;

  select * into v_existing from public.pm_bets
    where user_pubkey = p_user_pubkey and idempotency_key = p_idempotency_key limit 1;
  if v_existing.bet_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'bet_id', v_existing.bet_id);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_outcome_id::text));

  select om.outcome_id, om.status as o_status, om.round_id,
         mr.status as round_status, mr.lock_ts, mr.collateral_mint
    into v_outcome
    from public.outcome_markets om
    join public.market_rounds mr on mr.round_id = om.round_id
    where om.outcome_id = p_outcome_id
    for update of om;

  if v_outcome.outcome_id is null then raise exception 'OUTCOME_NOT_FOUND'; end if;
  if v_outcome.round_status <> 'OPEN' then raise exception 'ROUND_NOT_OPEN'; end if;
  if v_outcome.o_status <> 'ACTIVE' then raise exception 'OUTCOME_NOT_ACTIVE'; end if;
  if v_now >= v_outcome.lock_ts then raise exception 'ROUND_LOCKED'; end if;

  v_mint := v_outcome.collateral_mint;

  insert into public.users (wallet_address) values (p_user_pubkey) on conflict (wallet_address) do nothing;
  insert into public.user_balances (user_pubkey, mint) values (p_user_pubkey, v_mint) on conflict (user_pubkey, mint) do nothing;

  update public.user_balances
    set available_collateral = available_collateral - p_amount
    where user_pubkey = p_user_pubkey and mint = v_mint and available_collateral >= p_amount;
  if not found then raise exception 'INSUFFICIENT_COLLATERAL'; end if;

  insert into public.pm_bets (round_id, outcome_id, user_pubkey, side, amount, mint, fee_exempt, status, idempotency_key, created_at)
  values (v_outcome.round_id, p_outcome_id, p_user_pubkey, p_side, p_amount, v_mint, coalesce(p_fee_exempt,false), 'ACTIVE', p_idempotency_key, v_now)
  returning bet_id into v_bet;

  if p_side then
    update public.outcome_markets set yes_pool = yes_pool + p_amount, yes_bettor_count = yes_bettor_count + 1 where outcome_id = p_outcome_id;
  else
    update public.outcome_markets set no_pool = no_pool + p_amount, no_bettor_count = no_bettor_count + 1 where outcome_id = p_outcome_id;
  end if;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
  values (concat('bet:', v_bet::text), p_user_pubkey, p_outcome_id, -p_amount, 0, 0, 'bet', v_bet::text, v_mint, v_now)
  on conflict (event_key) do nothing;

  select yes_pool, no_pool into v_outcome from public.outcome_markets where outcome_id = p_outcome_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'bet_id', v_bet,
    'mint', v_mint, 'fee_exempt', coalesce(p_fee_exempt,false),
    'yes_pool', v_outcome.yes_pool, 'no_pool', v_outcome.no_pool);
end;
$$;

-- =============================================================================
-- pm_settle_round_parimutuel: settle a LOCKED round. p_winner_wallets = KOL
-- wallets that resolved YES (e.g. the top-N). Per-bet rake honours fee_exempt.
-- Idempotent: claims LOCKED/SETTLING -> SETTLED, pays only ACTIVE bets.
-- =============================================================================
create or replace function public.pm_settle_round_parimutuel(
  p_round_id text,
  p_winner_wallets text[],
  p_snapshot_hash text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_round record;
  v_rake_bps integer;
  v_outcome record;
  v_bet record;
  v_final boolean;
  v_win_pool numeric;
  v_lose_pool numeric;
  v_profit numeric;
  v_fee numeric;
  v_payout numeric;
  v_outcomes_settled integer := 0;
  v_total_paid numeric := 0;
  v_total_rake numeric := 0;
  v_now timestamp with time zone := now();
begin
  if p_round_id is null or length(trim(p_round_id)) = 0 then raise exception 'MISSING_ROUND_ID'; end if;

  perform pg_advisory_xact_lock(hashtext(p_round_id));

  select * into v_round from public.market_rounds where round_id = p_round_id for update;
  if v_round.round_id is null then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_round.status = 'SETTLED' then
    return jsonb_build_object('ok', true, 'already_settled', true, 'round_id', p_round_id);
  end if;
  if v_round.status not in ('LOCKED','SETTLING') then
    raise exception 'ROUND_NOT_SETTLEABLE: %', v_round.status;
  end if;

  update public.market_rounds set status = 'SETTLING' where round_id = p_round_id;
  v_rake_bps := coalesce(v_round.rake_bps, 0);

  for v_outcome in select * from public.outcome_markets where round_id = p_round_id for update loop
    if v_outcome.status = 'SETTLED' then continue; end if;

    v_final := v_outcome.kol_wallet_address = any(coalesce(p_winner_wallets, array[]::text[]));
    if v_final then v_win_pool := v_outcome.yes_pool; v_lose_pool := v_outcome.no_pool;
    else            v_win_pool := v_outcome.no_pool;  v_lose_pool := v_outcome.yes_pool; end if;

    if v_win_pool <= 0 then
      -- nobody on winning side: refund every active bet (push), no fee
      for v_bet in select * from public.pm_bets where outcome_id = v_outcome.outcome_id and status = 'ACTIVE' for update loop
        perform public.pm__credit_balance(v_bet.user_pubkey, v_bet.mint, v_bet.amount);
        update public.pm_bets set status='REFUNDED', payout=v_bet.amount, fee=0, settled_at=v_now where bet_id=v_bet.bet_id;
        insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
        values (concat('settle_refund:', v_bet.bet_id::text), v_bet.user_pubkey, v_outcome.outcome_id, v_bet.amount, 0, 0, 'settle_refund', v_bet.bet_id::text, v_bet.mint, v_now)
        on conflict (event_key) do nothing;
        v_total_paid := v_total_paid + v_bet.amount;
      end loop;
    else
      for v_bet in select * from public.pm_bets where outcome_id = v_outcome.outcome_id and status = 'ACTIVE' for update loop
        if v_bet.side = v_final then
          v_profit := round(v_lose_pool * v_bet.amount / v_win_pool, 9);
          if v_bet.fee_exempt then v_fee := 0;
          else v_fee := round(v_profit * v_rake_bps / 10000.0, 9); end if;
          if v_fee < 0 then v_fee := 0; end if;
          if v_fee > v_profit then v_fee := v_profit; end if;
          v_payout := v_bet.amount + v_profit - v_fee;
          perform public.pm__credit_balance(v_bet.user_pubkey, v_bet.mint, v_payout);
          update public.pm_bets set status='SETTLED', payout=v_payout, fee=v_fee, settled_at=v_now where bet_id=v_bet.bet_id;
          insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
          values (concat('settle_win:', v_bet.bet_id::text), v_bet.user_pubkey, v_outcome.outcome_id, v_payout, 0, 0, 'settle_win', v_bet.bet_id::text, v_bet.mint, v_now)
          on conflict (event_key) do nothing;
          v_total_paid := v_total_paid + v_payout;
          if v_fee > 0 then
            insert into public.pm_protocol_fees (round_id, outcome_id, mint, amount, created_at)
            values (p_round_id, v_outcome.outcome_id, v_bet.mint, v_fee, v_now);
            v_total_rake := v_total_rake + v_fee;
          end if;
        else
          update public.pm_bets set status='SETTLED', payout=0, fee=0, settled_at=v_now where bet_id=v_bet.bet_id;
        end if;
      end loop;
    end if;

    update public.outcome_markets set status='SETTLED', final_outcome=v_final, settled_at=v_now where outcome_id=v_outcome.outcome_id;
    v_outcomes_settled := v_outcomes_settled + 1;
  end loop;

  update public.market_rounds set status='SETTLED', snapshot_hash=coalesce(p_snapshot_hash, snapshot_hash) where round_id=p_round_id;

  return jsonb_build_object('ok', true, 'already_settled', false, 'round_id', p_round_id,
    'outcomes_settled', v_outcomes_settled, 'total_paid', v_total_paid, 'total_rake', v_total_rake);
end;
$$;

-- =============================================================================
-- pm_cancel_round_refund: cancel a round, refund every active bet 1:1 per mint.
-- =============================================================================
create or replace function public.pm_cancel_round_refund(p_round_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_round record; v_bet record; v_count integer := 0; v_now timestamp with time zone := now();
begin
  if p_round_id is null or length(trim(p_round_id)) = 0 then raise exception 'MISSING_ROUND_ID'; end if;
  perform pg_advisory_xact_lock(hashtext(p_round_id));
  select * into v_round from public.market_rounds where round_id = p_round_id for update;
  if v_round.round_id is null then raise exception 'ROUND_NOT_FOUND'; end if;
  if v_round.status = 'CANCELLED' then return jsonb_build_object('ok', true, 'already_cancelled', true); end if;
  if v_round.status = 'SETTLED' then raise exception 'ROUND_ALREADY_SETTLED'; end if;

  for v_bet in select * from public.pm_bets where round_id = p_round_id and status = 'ACTIVE' for update loop
    perform public.pm__credit_balance(v_bet.user_pubkey, v_bet.mint, v_bet.amount);
    update public.pm_bets set status='REFUNDED', payout=v_bet.amount, fee=0, settled_at=v_now where bet_id=v_bet.bet_id;
    insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
    values (concat('cancel_refund:', v_bet.bet_id::text), v_bet.user_pubkey, v_bet.outcome_id, v_bet.amount, 0, 0, 'cancel_refund', v_bet.bet_id::text, v_bet.mint, v_now)
    on conflict (event_key) do nothing;
    v_count := v_count + 1;
  end loop;

  update public.outcome_markets set status='CANCELLED' where round_id=p_round_id and status<>'SETTLED';
  update public.market_rounds set status='CANCELLED' where round_id=p_round_id;
  return jsonb_build_object('ok', true, 'already_cancelled', false, 'refunded_bets', v_count);
end;
$$;

-- =============================================================================
-- pm_request_withdrawal (OVERRIDE v3_030): per-mint debit.
-- =============================================================================
create or replace function public.pm_request_withdrawal(
  p_user_pubkey text, p_amount numeric, p_mint text, p_destination_pubkey text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_existing uuid; v_withdrawal uuid; v_now timestamp with time zone := now();
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then raise exception 'MISSING_USER_PUBKEY'; end if;
  if p_destination_pubkey is null or length(trim(p_destination_pubkey)) = 0 then raise exception 'MISSING_DESTINATION'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_mint is null or length(trim(p_mint)) = 0 then raise exception 'MISSING_MINT'; end if;

  select withdrawal_id into v_existing from public.escrow_withdrawals
    where user_pubkey = p_user_pubkey and idempotency_key = p_idempotency_key limit 1;
  if v_existing is not null then return jsonb_build_object('ok', true, 'withdrawal_id', v_existing); end if;

  insert into public.users (wallet_address) values (p_user_pubkey) on conflict (wallet_address) do nothing;
  insert into public.user_balances (user_pubkey, mint) values (p_user_pubkey, p_mint) on conflict (user_pubkey, mint) do nothing;

  update public.user_balances set available_collateral = available_collateral - p_amount
    where user_pubkey = p_user_pubkey and mint = p_mint and available_collateral >= p_amount;
  if not found then raise exception 'INSUFFICIENT_COLLATERAL'; end if;

  insert into public.escrow_withdrawals (user_pubkey, amount, mint, destination_pubkey, status, created_at, idempotency_key)
  values (p_user_pubkey, p_amount, p_mint, p_destination_pubkey, 'REQUESTED', v_now, p_idempotency_key)
  returning withdrawal_id into v_withdrawal;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
  values (concat('withdraw_request:', v_withdrawal::text), p_user_pubkey, null, -p_amount, 0, 0, 'withdraw_request', v_withdrawal::text, p_mint, v_now)
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'withdrawal_id', v_withdrawal);
end;
$$;

-- =============================================================================
-- pm_fail_withdrawal (OVERRIDE v3_030): refund to the correct per-mint balance.
-- =============================================================================
create or replace function public.pm_fail_withdrawal(
  p_withdrawal_id uuid, p_processing_nonce text, p_error text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row record;
begin
  if p_withdrawal_id is null then raise exception 'MISSING_WITHDRAWAL_ID'; end if;
  if p_processing_nonce is null or length(trim(p_processing_nonce)) < 8 then raise exception 'MISSING_PROCESSING_NONCE'; end if;

  select * into v_row from public.escrow_withdrawals
    where withdrawal_id = p_withdrawal_id and processing_nonce = p_processing_nonce for update;
  if v_row.withdrawal_id is null then raise exception 'WITHDRAWAL_NOT_CLAIMED'; end if;
  if v_row.status = 'SENT' then return jsonb_build_object('ok', true, 'status', 'SENT'); end if;

  update public.escrow_withdrawals set status='FAILED', error=p_error
    where withdrawal_id = p_withdrawal_id and processing_nonce = p_processing_nonce;

  perform public.pm__credit_balance(v_row.user_pubkey, v_row.mint, v_row.amount);

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, mint, created_at)
  values (concat('withdraw_fail:', v_row.withdrawal_id::text), v_row.user_pubkey, null, v_row.amount, 0, 0, 'withdraw_fail', v_row.withdrawal_id::text, v_row.mint, now())
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'status', 'FAILED');
end;
$$;

-- =============================================================================
-- Public read: parimutuel pools + implied probabilities + mint per outcome.
-- =============================================================================
create or replace function public.pm_round_outcomes(p_round_id text)
returns table(
  outcome_id uuid, kol_wallet_address text, question_text text,
  status public.pm_outcome_status, final_outcome boolean, collateral_mint text,
  yes_pool numeric, no_pool numeric, total_pool numeric, yes_prob numeric,
  yes_bettor_count integer, no_bettor_count integer
)
language sql security definer set search_path = public
as $$
  select om.outcome_id, om.kol_wallet_address, om.question_text, om.status, om.final_outcome,
         mr.collateral_mint,
         om.yes_pool, om.no_pool, (om.yes_pool + om.no_pool) as total_pool,
         case when (om.yes_pool + om.no_pool) > 0 then round(om.yes_pool / (om.yes_pool + om.no_pool), 6) else null end as yes_prob,
         om.yes_bettor_count, om.no_bettor_count
  from public.outcome_markets om
  join public.market_rounds mr on mr.round_id = om.round_id
  where om.round_id = p_round_id
  order by (om.yes_pool + om.no_pool) desc, om.created_at asc;
$$;

grant execute on function public.pm_round_outcomes(text) to anon;
grant execute on function public.pm_round_outcomes(text) to authenticated;

-- =============================================================================
-- Solvency snapshot per mint: liabilities the escrow must cover.
-- =============================================================================
create or replace function public.pm_solvency_snapshot()
returns table(mint text, available numeric, active_bet_stakes numeric, owed_fees numeric, pending_withdrawals numeric, total_liability numeric)
language sql security definer set search_path = public
as $$
  with mints as (
    select mint from public.user_balances
    union select mint from public.pm_bets
    union select mint from public.pm_protocol_fees
    union select mint from public.escrow_withdrawals
  )
  select m.mint,
    coalesce((select sum(available_collateral) from public.user_balances b where b.mint = m.mint), 0) as available,
    coalesce((select sum(amount) from public.pm_bets x where x.mint = m.mint and x.status = 'ACTIVE'), 0) as active_bet_stakes,
    coalesce((select sum(amount) from public.pm_protocol_fees f where f.mint = m.mint), 0) as owed_fees,
    coalesce((select sum(amount) from public.escrow_withdrawals w where w.mint = m.mint and w.status in ('REQUESTED','SENDING')), 0) as pending_withdrawals,
    coalesce((select sum(available_collateral) from public.user_balances b where b.mint = m.mint), 0)
      + coalesce((select sum(amount) from public.pm_bets x where x.mint = m.mint and x.status = 'ACTIVE'), 0)
      + coalesce((select sum(amount) from public.pm_protocol_fees f where f.mint = m.mint), 0)
      + coalesce((select sum(amount) from public.escrow_withdrawals w where w.mint = m.mint and w.status in ('REQUESTED','SENDING')), 0) as total_liability
  from mints m where m.mint is not null;
$$;
