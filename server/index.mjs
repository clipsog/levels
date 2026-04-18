import express from 'express'
import path from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Pool } = pg

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Render cwd is repo root; `__dirname` is reliable locally — try both. */
function resolveDistDir() {
  const candidates = [path.join(process.cwd(), 'dist'), path.join(__dirname, '..', 'dist')]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'index.html'))) return dir
  }
  return null
}

const distDir = resolveDistDir()

/** Render and other hosts set PORT; local dev can use LEVELS_API_PORT. */
const PORT = Number(process.env.PORT ?? process.env.LEVELS_API_PORT ?? 8787)
const PROFILE_KEY = process.env.LEVELS_PROFILE_KEY ?? 'default'

const databaseUrl = process.env.DATABASE_URL?.trim()

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ...(String(databaseUrl).includes('supabase.com')
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    })
  : new Pool({
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'levels',
      password: process.env.PGPASSWORD ?? 'levels_dev_password',
      database: process.env.PGDATABASE ?? 'levels',
      ...(process.env.PGSSL === '1'
        ? { ssl: { rejectUnauthorized: false } }
        : {}),
    })

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '3mb' }))

/** Liveness for Render (must stay 200 or deploy never goes “Live”). */
app.get('/health', (_req, res) => {
  res.json({ ok: true })
})
app.head('/health', (_req, res) => {
  res.sendStatus(200)
})

/** Readiness: verifies Postgres / Supabase. Use for monitoring, not Render’s default check. */
app.get('/health/db', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.json({ ok: true, database: true })
  } catch (err) {
    res.status(503).json({ ok: false, database: false, error: String(err) })
  }
})

app.get('/api/state', async (_req, res) => {
  try {
    const q = await pool.query('select state from app_state where profile_key = $1 limit 1', [
      PROFILE_KEY,
    ])
    const row = q.rows[0]
    res.json({ state: row?.state ?? null })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.put('/api/state', async (req, res) => {
  try {
    const incoming = req.body?.state
    if (incoming == null || typeof incoming !== 'object') {
      res.status(400).json({ error: 'body.state (object) is required' })
      return
    }
    await pool.query(
      `insert into app_state (profile_key, state)
       values ($1, $2::jsonb)
       on conflict (profile_key)
       do update set state = excluded.state, updated_at = now()`,
      [PROFILE_KEY, JSON.stringify(incoming)],
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

if (distDir) {
  const indexHtml = path.join(distDir, 'index.html')
  /** Explicit `/` so Express 5 + static never leave root as “Cannot GET /”. */
  app.get('/', (_req, res) => {
    res.sendFile(indexHtml)
  })
  app.use(express.static(distDir, { index: false }))
  /** SPA fallback (Express 5: avoid `*` route pattern). */
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) return next()
    res.sendFile(indexHtml, (err) => (err ? next(err) : undefined))
  })
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('text')
      .send(
        `Levels UI missing: no dist/index.html. Run "npm run build" before start. cwd=${process.cwd()} __dirname=${__dirname}`,
      )
  })
}

app.listen(PORT, '0.0.0.0', () => {
  const mode = distDir ? `API + static (${distDir})` : 'API only (no dist)'
  console.log(`Levels listening on port ${PORT} — ${mode}`)
})
