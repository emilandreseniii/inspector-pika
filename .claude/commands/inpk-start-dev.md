---
description: Start the Inspector Pika dev environment (shared, server, client) so the app is accessible at http://localhost:5173.
---

You are starting the Inspector Pika dev environment. Follow the steps below in order.

## Step 1 — Check prerequisites

Run the following checks before starting any services:

```bash
# Confirm .env exists
ls .env
```

If `.env` is missing, run `node scripts/setup.js` and stop — the user must fill in `GITHUB_TOKEN` and `DATABASE_URL` before proceeding.

```bash
# Confirm node_modules are installed at the root
ls node_modules/.bin/concurrently
```

If `concurrently` is missing, run `npm install` first.

## Step 2 — Run database migrations

The server requires an up-to-date schema before it can start:

```bash
npm run db:migrate
```

If this fails, the most likely cause is a wrong or unreachable `DATABASE_URL` in `.env`. Report the error to the user and stop.

## Step 3 — Start all dev services

Run the three workspaces concurrently in the background:

```bash
npm run dev
```

This single command (defined in the root `package.json`) runs:
- `shared` — TypeScript watch build (consumed by both server and client)
- `server` — Express API via `tsx watch` on its configured port (default 3000)
- `client` — Vite dev server at **http://localhost:5173**

Start this command in the background using `run_in_background: true` so the terminal is not blocked.

## Step 4 — Confirm services are up

After starting, tell the user:

- **App URL:** http://localhost:5173
- **API URL:** http://localhost:3000 (or whatever port is set in `.env`)
- **Vite HMR** is active — edits to `client/src/` reload instantly
- **Server watch** is active — edits to `server/src/` restart the API automatically
- **Shared watch** is active — changes to `shared/src/` are compiled and picked up by both

Remind the user that stopping the background process (Ctrl-C in the terminal running `npm run dev`) shuts down all three services.
