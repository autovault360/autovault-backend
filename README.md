# AutoVault Backend (v2)

Express + Prisma + **PostgreSQL** + **Redis** multi-tenant CRM API for the Static frontend.

## Stack

| Layer | Choice |
|-------|--------|
| API | Express (ESM) |
| ORM | Prisma 6 |
| Database | PostgreSQL (Neon or self-hosted) |
| Jobs / cache | Redis (`REDIS_URL`) or Upstash REST fallback |
| Auth | JWT access + refresh, bcrypt |
| Email | Brevo |
| Payments | Stripe |
| Files | Cloudflare R2 (presigned PUT/GET) |

MongoDB has been removed from the CRM domain.

## Quick start

1. Create a PostgreSQL database and copy the connection string.
2. Run Redis locally/on VPS (`REDIS_URL`) **or** create an Upstash Redis DB (REST URL + token).
3. Copy env template and fill values:

```bash
cp .env.example .env
```

Required:

- `DATABASE_URL` ? Neon connection string (`?sslmode=require`)
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (or legacy `JWT_SECRET`)
- `OWNER_API_KEY`
- Stripe + Resend keys for onboarding emails

Optional:

- `REDIS_URL` (preferred on VPS, e.g. `redis://127.0.0.1:6379`)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (used only if `REDIS_URL` is empty)
- Cloudflare R2 (required for file uploads):
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET`
  - `R2_PUBLIC_BASE_URL` (r2.dev or custom domain)

### Cloudflare R2 setup

1. Create a bucket (e.g. `autovault`).
2. **R2 ? Manage R2 API Tokens ? Create API token** with Object Read & Write on that bucket.
3. Copy Account ID, Access Key ID, Secret Access Key into `.env`.
4. (Recommended) Enable a public bucket URL or custom domain ? set `R2_PUBLIC_BASE_URL`.
5. **Required for browser uploads:** configure bucket CORS (dashboard or script below).
   Without this, `PUT` from `localhost:5500` / production is blocked by CORS preflight.

Dashboard (R2 ? your bucket ? Settings ? CORS Policy), paste:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "https://www.autovault360.com",
      "https://autovault360.com"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Or apply via script (uses your `.env` R2 keys):

```bash
npm run r2:cors
```

Upload flow:

1. `POST /api/v1/files/upload-url` ? `{ uploadUrl, file, publicUrl }`
2. Browser `PUT` file bytes to `uploadUrl` with `Content-Type`
3. `GET /api/v1/files/:id` ? metadata + signed `downloadUrl`

4. Install and migrate:

```bash
npm install
npx prisma migrate dev --name init
# or for first deploy against Neon:
npx prisma db push
npm run db:seed
npm run dev
```

5. Health check: `GET http://localhost:3000/health`

## API versioning

- Preferred: `/api/v1/...`
- Legacy Static compatibility: `/api/auth/*`, `/api/registrations`, `/api/checkout`, `/api/owner/*`
- Stripe webhook: `POST /api/webhooks/stripe` (raw body)

## Module map

| Phase | Module | Base path |
|-------|--------|-----------|
| 1 | Auth | `/api/v1/auth` |
| 2 | Dealerships / onboarding | `/api/v1/dealerships`, `/api/v1/registrations`, `/api/v1/checkout` |
| 3 | Users / invites | `/api/v1/users`, `/api/v1/invitations` |
| 4 | Dashboard / audit / notifications | `/api/v1/dashboard`, `/api/v1/audit-logs`, `/api/v1/notifications` |
| 5 | Vehicles / flooring | `/api/v1/vehicles`, `/api/v1/flooring-plans` |
| 6 | Customers / leads | `/api/v1/customers`, `/api/v1/leads` |
| 7 | Deals / jackets | `/api/v1/deal-jackets`, mark-sold |
| 8 | Expenses / P&L | `/api/v1/expenses`, `/api/v1/reports` |
| 9 | Payroll | `/api/v1/sales-reps`, `/api/v1/payroll-runs` |
| 10 | Tax | `/api/v1/tax` |
| 11 | CPA | `/api/v1/cpa` |
| 12?15 | Calendar, messages, files, platform | `/api/v1/calendar`, `/messages`, `/files`, `/platform` |

Tax reminder cron (secure with owner key):

`GET /api/v1/jobs/tax-reminders` with header `x-cron-key: $OWNER_API_KEY`

## Multi-tenancy

Every tenant row is scoped by `dealershipId`. JWT carries `dealershipId` + `role`. Services must never trust a client-supplied tenant id for non?platform-owner users.

## Frontend

Static client (`../client`):

- `api.js` ? API client with refresh rotation
- `crm-bootstrap.js` ? loads live dashboard data when logged in
- `/forgot-password`, `/reset-password`, `/invite`

## Redis on a VPS (recommended)

Install Redis on the same machine as the API, then point the app at it with `REDIS_URL`.

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y redis-server

# Bind to localhost only (default is usually fine)
sudo sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
# Ensure: bind 127.0.0.1 ::1
# Optional: requirepass YOUR_STRONG_PASSWORD

sudo systemctl enable redis-server
sudo systemctl restart redis-server
redis-cli ping   # expect PONG
```

In `/var/www/autovault-backend/.env`:

```env
REDIS_URL=redis://127.0.0.1:6379
# With password:
# REDIS_URL=redis://:YOUR_STRONG_PASSWORD@127.0.0.1:6379
```

Leave `UPSTASH_*` empty (or unset) so local Redis is used. Restart the Node process after changing env.

Used for: Jenna daily quota + email job enqueue lists.

## Deploy (Render)

1. Connect the `Static/server` repo/folder.
2. Set env vars (DB URL, `REDIS_URL` or Upstash, JWT, Stripe, Brevo).
3. Build: `npm install && npx prisma generate`
4. Start: `npx prisma migrate deploy && npm start`
5. Point Vercel `AUTOVAULT_API_URL` (or default Render URL) at this service.
6. Stripe webhook ? `https://<render-host>/api/webhooks/stripe`

## Tests

```bash
npm test
```

Unit tests always run. Integration tests run when `DATABASE_URL` is set.

## Deferred (post-MVP)

Jenna AI, team chat, arbitration, missing titles, sticky notes.
