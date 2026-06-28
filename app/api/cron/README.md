# Cron tick (`/api/cron/tick`)

Host-agnostic scheduler tick. The app does **not** lock, settle, or pay out
rounds on its own — those operations only run when something POSTs the admin
routes. This endpoint is that "something": a single orchestrator that fans out,
server-to-server, to the admin operations on a fixed cadence.

On each invocation it calls, in order:

1. `POST /api/admin/pm/rounds/lock` — lock rounds whose `lock_ts` has passed.
2. `POST /api/admin/pm/rounds/settle` — settle rounds whose `settle_ts` has passed.
3. `POST /api/admin/pm/withdrawals/process` — send due withdrawals.
4. `POST /api/admin/helius/webhook/sync` — refresh the tracked-wallet set.

Each sub-call is wrapped in its own try/catch. One failure never aborts the
others; the tick always returns `200` with a per-step summary:

```json
{ "ok": true, "baseUrl": "https://your-app", "steps": { "lock": { "ok": true, "status": 200, "body": { /* ... */ } }, "settle": { "...": "..." }, "withdrawals": { "...": "..." }, "heliusSync": { "...": "..." } } }
```

A failed step looks like `{ "ok": false, "status": 500, "body": { "error": "..." } }`
(or `{ "ok": false, "status": null, "error": "fetch failed" }` if the request
threw). Failures are also logged via `console.error`.

## Environment variables

| Variable             | Required | Purpose                                                                                                   |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`        | Yes      | Bearer token that authorizes this endpoint. Must be set on every deployed environment (fails closed).     |
| `ADMIN_API_KEY`      | Yes      | Forwarded as `Authorization: Bearer …` to each downstream admin route so they accept the call.            |
| `NEXT_PUBLIC_APP_URL`| Optional | Absolute base URL (incl. scheme) used for the server-to-server fan-out, e.g. `https://app.example.com`.    |

Base-URL resolution order:

1. `NEXT_PUBLIC_APP_URL` (preferred — explicit, includes scheme).
2. `VERCEL_URL` (host only; auto-set by Vercel, prefixed with `https://`).
3. The incoming request's own origin (fallback; works on any host, including
   `localhost` during development).

> The downstream admin routes themselves require additional env vars to do real
> work (e.g. `SUPABASE_SERVICE_ROLE_KEY`, the `ESCROW_WALLET_*` keys for
> withdrawals, and `HELIUS_API_KEY` / `HELIUS_WEBHOOK_ID` for the sync). See the
> root `.env.example`. If those are missing the tick still returns `200`, but the
> relevant step reports an error in its `body`.

## Authentication

The endpoint **always requires `CRON_SECRET`** (it fails closed: when the secret
is unset on a deployed environment the request is rejected with `500`). A request
is allowed when **either**:

- it presents a valid `Authorization: Bearer ${CRON_SECRET}` header, **or**
- it carries Vercel Cron's `x-vercel-cron` header **and** is same-origin
  (same `Host`).

The bearer is always preferred and is the only option for non-Vercel schedulers.

## Triggering with Vercel Cron

`vercel.json` (repo root) schedules the tick every minute:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "* * * * *" }] }
```

Vercel Cron invokes the path with **GET** and **no `Authorization` header**.
Instead, Vercel attaches the `x-vercel-cron: 1` header to its own scheduled
requests, and those requests originate from the deployment itself (same-origin).
The handler recognizes that header on a same-origin request and lets Vercel's
scheduler through, so you do **not** need to inject the bearer for Vercel Cron —
just set `CRON_SECRET` (so the endpoint is not open) and `ADMIN_API_KEY`.

> If you would rather authenticate Vercel Cron with the bearer explicitly, Vercel
> automatically forwards a `CRON_SECRET` project env var as
> `Authorization: Bearer <CRON_SECRET>` on cron invocations — setting that var is
> enough and the bearer path above will validate it.

## Non-Vercel schedulers (pg_cron, GitHub Actions, system cron, …)

Any external scheduler can drive the tick by curling the endpoint once a minute
with the bearer token. Vercel's `x-vercel-cron` shortcut does **not** apply
off-Vercel, so the `CRON_SECRET` bearer is mandatory here.

System cron (`crontab -e`):

```cron
* * * * * curl -fsS -X POST https://your-app.example.com/api/cron/tick -H "Authorization: Bearer $CRON_SECRET" >/dev/null 2>&1
```

Supabase / Postgres `pg_cron` (requires the `pg_cron` and `pg_net` extensions):

```sql
select cron.schedule(
  'trade-wars-tick',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://your-app.example.com/api/cron/tick',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

GitHub Actions:

```yaml
on:
  schedule:
    - cron: "* * * * *"
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS -X POST "$APP_URL/api/cron/tick" -H "Authorization: Bearer $CRON_SECRET"
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```

GET also works (`curl -fsS "https://your-app.example.com/api/cron/tick" -H "Authorization: Bearer $CRON_SECRET"`); the handler exports both `GET` and `POST`.
