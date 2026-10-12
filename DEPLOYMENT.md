# Deployment

The app is two deployable pieces:

| Piece | What it needs |
|---|---|
| `web/` | Any static host. It is a Vite build — HTML, CSS, one JS bundle. |
| `api/` | A host with a **persistent writable filesystem**. |

That second requirement is the only thing that makes this interesting.

## Why the API cannot go on Vercel as-is

The API stores state in a SQLite file. Serverless functions — Vercel, Netlify
Functions, Lambda — give each invocation an ephemeral filesystem. A row written
during one request is not there on the next, and nothing warns you: the first
request succeeds, the second returns an empty list, and the bug looks like a
caching problem for an hour.

So the API needs a real disk, or a database that is reachable over the network.
Two routes below.

---

## Route A — persistent disk (no code changes)

The API deploys as a long-running Node process with a mounted volume.
`api/render.yaml` is a ready blueprint:

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo. It reads
   `api/render.yaml`: root directory `api`, build `npm ci && npm run build`,
   start `npm start`, health check `/api/health`, and a 1 GB disk mounted at
   `/data` with `DATABASE_FILE=/data/invoices.db`.
3. Once it is live, seed it once from the Render shell:
   ```bash
   npm run db:seed
   ```
4. Deploy the frontend (below), then set `CORS_ORIGIN` on the API to the
   frontend's URL and redeploy.

Railway and Fly.io work the same way — a Node service plus a mounted volume.

> **Cost:** persistent disks are a paid feature on Render (its free tier has no
> disk). Fly.io includes a small volume allowance on its free plan. If you want
> zero cost, use Route B.

## Route B — serverless, with a hosted SQLite (small code change)

[Turso](https://turso.tech) is SQLite over HTTP with a free tier, so both pieces
can live on Vercel. Drizzle supports it through a different driver, which makes
this a change to one file rather than a rewrite:

```bash
cd api && npm install @libsql/client
```

```diff
  // api/src/db/index.ts
- import Database from 'better-sqlite3';
- import { drizzle } from 'drizzle-orm/better-sqlite3';
+ import { createClient } from '@libsql/client';
+ import { drizzle } from 'drizzle-orm/libsql';

- export const sqlite = new Database(DB_FILE);
- export const db = drizzle(sqlite, { schema });
+ const client = createClient({
+   url: process.env.TURSO_DATABASE_URL!,
+   authToken: process.env.TURSO_AUTH_TOKEN,
+ });
+ export const db = drizzle(client, { schema });
```

The schema, the queries, the routes, the detection rule and the UI are all
untouched — Drizzle abstracts the driver. The `sqlite.exec()` calls in
`initialiseSchema()` and the seed become `client.execute()`.

Then deploy the API as a Vercel project with `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` set.

---

## Frontend (either route)

`web/vercel.json` is configured: Vite framework preset, `dist` output, and an
SPA rewrite so deep links resolve.

1. Vercel → **Add New → Project** → select the repo.
2. Set **Root Directory** to `web`.
3. Add an environment variable:
   ```
   VITE_API_BASE_URL = https://your-api-host.example.com
   ```
   This is read at **build** time, so changing it needs a redeploy.
4. Deploy.

With `VITE_API_BASE_URL` unset the frontend calls `/api/...` on its own origin,
which only works behind the Vite dev proxy — so it must be set for any real
deployment.

## Environment variables

Nothing here is secret in the current setup, but `.env` is gitignored and only
`.env.example` is committed, so secrets have somewhere to go later.

| Where | Variable | Purpose |
|---|---|---|
| `api` | `DATABASE_FILE` | SQLite path. Default `invoices.db`; set to the mounted disk in production. |
| `api` | `PORT` | Default `4000`. |
| `api` | `CORS_ORIGIN` | Pins the API to one frontend origin. Unset allows any — fine locally, not in production. |
| `web` | `VITE_API_BASE_URL` | API origin, baked in at build time. |

Locally, `cp .env.example .env` in each folder is the whole setup.

## After deploying — verify, do not assume

```bash
curl https://your-api-host/api/health
curl https://your-api-host/api/invoices | head -c 300

# Persistence: change a status, then read it back
curl -X PATCH https://your-api-host/api/invoices/<id>/status \
  -H 'Content-Type: application/json' -d '{"status":"approved"}'
curl https://your-api-host/api/invoices/<id>
```

If the second read does not show `approved`, the host is not persisting and you
are on an ephemeral filesystem. That is the failure this document exists to
prevent.

Then open the frontend, approve something, and **reload the page**. The status
must survive the reload.
