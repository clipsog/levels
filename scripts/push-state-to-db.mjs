/**
 * Upsert Levels app state into Postgres (e.g. Supabase) from a JSON file.
 * The UI keeps data in localStorage under `levels-finance-v2`; this pushes it to `app_state`.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' node scripts/push-state-to-db.mjs ./my-state.json
 *
 * The file may be either:
 *   - The raw state object (same shape as in localStorage), or
 *   - { "state": { ... } } as sent to PUT /api/state
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('Set DATABASE_URL to your Supabase (or Postgres) connection string.')
  process.exit(1)
}

const profileKey = process.env.LEVELS_PROFILE_KEY?.trim() || 'default'
const fileArg = process.argv[2]
if (!fileArg) {
  console.error('Usage: DATABASE_URL=... node scripts/push-state-to-db.mjs <path-to.json>')
  process.exit(1)
}

const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg)
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath)
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
} catch (e) {
  console.error('Invalid JSON file:', e.message)
  process.exit(1)
}

/** Allow double-encoded export (string of JSON). */
function unwrapState(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'state' in v && typeof v.state === 'object') {
    return v.state
  }
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  return v
}

const state = unwrapState(parsed)
if (state == null || typeof state !== 'object' || Array.isArray(state)) {
  console.error('Expected a JSON object (Levels state), or { "state": { ... } }.')
  process.exit(1)
}

const ssl = String(databaseUrl).includes('supabase.com')
  ? { rejectUnauthorized: false }
  : undefined

const client = new pg.Client({ connectionString: databaseUrl, ssl })
await client.connect()

await client.query(
  `insert into app_state (profile_key, state)
   values ($1, $2::jsonb)
   on conflict (profile_key)
   do update set state = excluded.state, updated_at = now()`,
  [profileKey, JSON.stringify(state)],
)

await client.end()
console.log(`Upserted app_state for profile_key=${profileKey} (${Object.keys(state).length} top-level keys).`)
