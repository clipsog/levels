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
import { syncLevelsTaggedBillsToShared } from '../server/shared-subscription-sync.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

/** Load `.env` from repo root if present (does not override existing env). */
function loadDotEnv() {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error(
    'Missing DATABASE_URL. Add it to .env in the repo root, or export DATABASE_URL=... in your shell.',
  )
  process.exit(1)
}

const profileKey = process.env.LEVELS_PROFILE_KEY?.trim() || 'default'

const home = process.env.HOME || process.env.USERPROFILE || ''
const defaultPaths = [
  path.join(process.cwd(), 'local-state.json'),
  path.join(process.cwd(), 'levels-state-export.json'),
  home ? path.join(home, 'Downloads', 'levels-state-export.json') : '',
].filter(Boolean)

const fileArg =
  process.argv[2] ||
  defaultPaths.find((p) => fs.existsSync(p))

if (!fileArg) {
  console.error(
    'Pass a JSON file path, or open http://127.0.0.1:5176/export-state.html → Download, then run this again (looks for local-state.json, levels-state-export.json, or ~/Downloads/levels-state-export.json).',
  )
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

const sharedUrl = process.env.SHARED_FINANCE_DATABASE_URL?.trim()
if (sharedUrl) {
  const sharedSsl = String(sharedUrl).includes('supabase.com')
    ? { rejectUnauthorized: false }
    : undefined
  const sharedPool = new pg.Pool({ connectionString: sharedUrl, ssl: sharedSsl })
  try {
    await syncLevelsTaggedBillsToShared(sharedPool, profileKey, state)
    console.log('Synced Levels bills tagged for Assets → shared_subscriptions (SHARED_FINANCE_DATABASE_URL).')
  } catch (e) {
    console.error('Shared subscription sync failed:', e?.message ?? e)
  } finally {
    await sharedPool.end()
  }
}

await client.end()
console.log(`Upserted app_state for profile_key=${profileKey} (${Object.keys(state).length} top-level keys).`)
