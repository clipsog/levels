import express from 'express'
import pg from 'pg'

const { Pool } = pg

const PORT = Number(process.env.LEVELS_API_PORT ?? 8787)
const PROFILE_KEY = process.env.LEVELS_PROFILE_KEY ?? 'default'

const pool = new Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'levels',
  password: process.env.PGPASSWORD ?? 'levels_dev_password',
  database: process.env.PGDATABASE ?? 'levels',
})

const app = express()
app.use(express.json({ limit: '3mb' }))

app.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
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

app.listen(PORT, () => {
  console.log(`Levels API listening on http://localhost:${PORT}`)
})
