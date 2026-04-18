# Levels

## Deploy on [Render](https://render.com)

1. New **Web Service** → connect this repo.
2. **Build command:** `npm ci && npm run build` (or `npm install && npm run build`).
3. **Start command (important):** use **`exec node server/index.mjs`** or at least **`node server/index.mjs`**. Do **not** use plain **`npm start`** on Render: `npm` stays the parent process while Node listens in a child, which often triggers Render’s **“New primary port detected”** loop and a deploy that never finishes. Locally, `npm start` is still fine.
4. **Environment:** add **`DATABASE_URL`** (your Supabase connection string). Render sets **`PORT`** automatically; the server uses it.
5. Optional: use **`render.yaml`** in the repo root for a [Blueprint](https://render.com/docs/blueprint-spec).

Production serves the Vite build from the same process as the API, so the UI keeps calling **`/api/state`** on the same host (no extra `VITE_*` URL).

**Render health check:** use **`/health`** (always 200 if the process is up). **`/health/db`** checks Postgres/Supabase (503 if the DB is down — use that for monitoring, not as Render’s only health URL, or deploys can loop when `DATABASE_URL` is wrong).

---

## Local PostgreSQL (dev)

The app persists to PostgreSQL through a local API (`server/index.mjs`), with `localStorage` as backup fallback.

If your machine already has PostgreSQL running locally, use:

- Host: `localhost`
- Port: `5432`
- Database: `levels`
- User: `levels`
- Password: `levels_dev_password`

If you prefer Docker Postgres instead, this repo also includes `docker-compose.yml`:

```bash
npm run db:up
```

Docker DB defaults:

- Host: `localhost`
- Port: `54329`
- Database: `levels`
- User: `levels`
- Password: `levels_dev_password`

### Run app + API together

```bash
npm install
npm run dev:full
```

- Levels UI: `http://localhost:5176/`
- Levels API: `http://localhost:8787/`

### Run Levels + Assets (scheduler) together

**Assets** (scheduler app) lives next to this repo:

- Folder: `/Users/duboisca/.gemini/antigravity/scratch/value-scheduler`
- Dev URL: `http://localhost:5190/`

One command starts **API + Levels + Assets**:

```bash
npm install
npm install --prefix ../.gemini/antigravity/scratch/value-scheduler
npm run dev:all
```

Or run the helper script:

```bash
./scripts/run-dev-stack.sh
```

### Keep dev stack “always on” (optional, macOS)

Copy `scripts/launchd/com.duboisca.levels-assets.plist.example` to `~/Library/LaunchAgents/`, adjust paths if needed, then:

```bash
launchctl load ~/Library/LaunchAgents/com.duboisca.levels-assets.plist
```

Stop with `launchctl unload ...`. Logs go to `/tmp/levels-assets-dev.log`.

Or run separately:

```bash
npm run api
npm run dev
```

Vite proxies `/api/*` to `http://localhost:8787`.

### DB utility commands (Docker workflow)

- Open SQL shell: `npm run db:psql`
- Follow DB logs: `npm run db:logs`
- Stop DB: `npm run db:down`
- Full reset (drops Docker DB volume): `npm run db:reset`

## Schema location

The initialization SQL is in:

- `db/init/001_schema.sql`

It creates a base `app_state` JSONB table to store app snapshots and is Postgres-compatible for Supabase.

### Apply schema to Supabase (or any Postgres)

Set `DATABASE_URL` to your connection string, then:

```bash
npm run db:migrate
```

This runs every `db/init/*.sql` file in sorted order via `scripts/migrate.mjs`.

### Copy your **local** data into Supabase (or any hosted DB)

The UI stores a copy in the browser as **`localStorage`** key **`levels-finance-v2`**. The hosted app reads/writes the same shape in Postgres table **`app_state`** (`profile_key` = `default`). Nothing syncs **from** your laptop **to** Supabase until you upload it once.

**Easiest (dev):** with **`npm run dev:full`** running, open **`/export-state.html` on the same host as Levels** (e.g. if the app is `http://localhost:5176`, use `http://localhost:5176/export-state.html` — **`localhost` and `127.0.0.1` do not share localStorage**). Or use the **“Download backup JSON”** link on the app (it uses your current host). Click **Download** — you get valid JSON.

1. Put **`DATABASE_URL`** in a **`.env`** file in the repo root (see **`.env.example`**; `.env` is gitignored), **or** export it in the shell.
2. From the repo root:

```bash
npm run db:push-state
```

With no filename, the script looks for **`./local-state.json`**, **`./levels-state-export.json`**, or **`~/Downloads/levels-state-export.json`**.

Or pass an explicit path:

```bash
npm run db:push-state -- ./my-state.json
```

Optional: **`LEVELS_PROFILE_KEY=myprofile`** if you use a non-default profile on the server.

3. Reload the **production** site; it will **`GET /api/state`** and load that snapshot.

**Via HTTP instead of DB** (no `DATABASE_URL` on your laptop): create **`payload.json`** containing `{"state": ... }` (same object as in localStorage), then:

```bash
curl -sS -X PUT "https://YOUR-SERVICE.onrender.com/api/state" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

## Move to Supabase later

When ready for production:

1. Create a Supabase project and run `npm run db:migrate` with `DATABASE_URL` set (or paste `db/init/001_schema.sql` in the Supabase SQL editor).
2. Point the API at Supabase using `DATABASE_URL`.
3. Add auth + row-level security policies before exposing writes publicly.
