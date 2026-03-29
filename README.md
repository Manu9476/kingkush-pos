# KingKush Sale

KingKush Sale is a full-stack supermarket and retail sales system built with React, Vite, TypeScript, and Postgres. The app now uses server-side authentication, transactional sales flows, audit logging, and a database-backed compatibility layer instead of browser-only storage.

## What Changed

- Passwords are stored as secure hashes, not plaintext.
- Sessions are stored server-side with signed cookies.
- Sales, refunds, credit payments, stock movements, and purchase-order receiving run through transactional API endpoints.
- The old browser `localStorage` data model has been replaced with Postgres as the source of truth.
- Existing UI screens still use the familiar collection/doc/query style through `src/data.ts`, but those calls now go through authenticated API routes.
- A one-time migration imports legacy `app_store` data into the normalized Postgres schema automatically.

## Stack

- Frontend: React 19 + Vite + TypeScript
- Backend: Vercel-style serverless API routes in `api/`
- Database: Postgres / Neon
- Local full-stack runtime: `server.ts`

## Required Environment Variables

Copy `.env.example` and set:

```bash
POSTGRES_URL="postgres://user:password@host/dbname?sslmode=require"
BOOTSTRAP_ADMIN_USERNAME="admin"
BOOTSTRAP_ADMIN_PASSWORD="ChangeMeToAStrongPassword"
BOOTSTRAP_ADMIN_DISPLAY_NAME="Super Admin"
```

Notes:

- `POSTGRES_URL` or `DATABASE_URL` is required for the app to work.
- If `BOOTSTRAP_ADMIN_PASSWORD` is not set, the login page will show a first-run setup form until a superadmin is created.
- In production, keep all secrets in your hosting platform's environment variable manager.

## Local Development

Install dependencies:

```bash
npm install
```

For frontend-only development:

```bash
npm run dev
```

This starts Vite on `http://localhost:5174`.

For full-stack local development with API routes:

```bash
npm run dev:server
```

This starts the Node runtime on `http://localhost:3000` and serves both the UI and the API routes from the same process.

## Production Build

```bash
npm run lint
npm run test
npm run build
```

To serve the production bundle locally:

```bash
npm run start
```

## Deployment

### Vercel

1. Import the repository into Vercel.
2. Attach a Postgres database such as Neon.
3. Set `POSTGRES_URL` or `DATABASE_URL`.
4. Optionally set the `BOOTSTRAP_ADMIN_*` variables for non-interactive setup.
5. Deploy.

The `vercel.json` rewrite configuration keeps SPA routes working while preserving `/api/*` endpoints.

### Operational Recommendations

- Enable automated Postgres backups and point-in-time recovery.
- Use strong admin passwords and rotate them when staff changes.
- Test a full flow on staging before go-live:
  - first-time bootstrap
  - login/logout
  - create product
  - make sale
  - process refund
  - receive stock
  - settle credit
  - receive purchase order
- Review audit logs regularly.

## Core Production Capabilities Now Covered

- Server-side authentication and session management
- Role and permission enforcement on API routes
- Transactional checkout with stock locking
- Transactional refunds
- Credit ledger updates and payment settlement
- Inventory ledger with supplier, unit cost, and traceability fields
- Purchase-order receiving with stock updates
- Audit log capture for critical actions
- Legacy data migration from the old blob store

## Scripts

- `npm run dev` - Vite frontend development server
- `npm run dev:server` - full-stack local runtime with API routes
- `npm run build` - production frontend build
- `npm run preview` - preview the production frontend build
- `npm run start` - serve the production app through `server.ts`
- `npm run lint` - TypeScript validation
- `npm run test` - node test suite for auth and security helpers

## Important Files

- `backend/lib/db.ts` - schema creation, migrations, transactions, seed/bootstrap logic
- `api/auth/[action].ts` - compact Vercel entrypoint for login, logout, and session lookup
- `api/transactions/[action].ts` - compact Vercel entrypoint for sale, refund, inventory, credit, and PO flows
- `backend/handlers/*` - route implementations used by the grouped Vercel entrypoints
- `api/data.ts` - authenticated compatibility data API
- `src/data.ts` - frontend adapter that preserves the existing query style
- `src/services/platformApi.ts` - typed client for critical backend actions

## Testing

Current automated tests cover:

- password hashing and verification
- session token hashing and cookie parsing
- permission normalization and authorization helpers

Run them with:

```bash
npm run test
```
