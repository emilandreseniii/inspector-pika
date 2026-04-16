#!/bin/bash
set -e

# Start the SSH daemon so you can `ssh -p 2222 pika@localhost` to get a shell
/usr/sbin/sshd

if [ -n "$DATABASE_URL" ]; then
  echo "==> Pushing Drizzle schema (creates base tables on a fresh database)..."
  # drizzle-kit push prompts for confirmation; feed it 'y' via stdin
  cd /app/server && printf 'y\n' | npx drizzle-kit push:pg 2>&1 || true

  echo "==> Running incremental migrations (migrate.mjs)..."
  cd /app && npm run db:migrate

  echo "==> Applying entity/API analysis schema (migrate.sql)..."
  psql "$DATABASE_URL" -f /app/scripts/migrate.sql

  echo "==> Database initialisation complete."
fi

# Start all dev servers: shared tsc watcher, Express, Vite
cd /app
exec npm run dev
