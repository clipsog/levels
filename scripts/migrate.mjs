/**
 * Apply db/init SQL files to the database pointed at by DATABASE_URL.
 * Usage: DATABASE_URL=... node scripts/migrate.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('Set DATABASE_URL (e.g. your Supabase connection string).')
  process.exit(1)
}

const ssl = String(databaseUrl).includes('supabase.com')
  ? { rejectUnauthorized: false }
  : undefined

const client = new pg.Client({ connectionString: databaseUrl, ssl })
await client.connect()

const initDir = path.join(root, 'db', 'init')
const files = fs
  .readdirSync(initDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

for (const file of files) {
  const full = path.join(initDir, file)
  const sql = fs.readFileSync(full, 'utf8')
  console.log('Applying', path.relative(root, full))
  await client.query(sql)
}

await client.end()
console.log('Migration finished.')
