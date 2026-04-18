# Levels

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

It creates a base `app_state` JSONB table to store app snapshots and is Postgres-compatible for future Supabase migration.

## Move to Supabase later

When ready for production:

1. Create a Supabase project.
2. Run the same SQL from `db/init/001_schema.sql` in Supabase SQL editor.
3. Replace local DB connection values with Supabase connection/env vars.
4. Add auth + row-level security policies before exposing writes publicly.
