/**
 * Link Levels + Assets data into one shared schema with zero-loss snapshots.
 *
 * Usage:
 *   TARGET_DATABASE_URL='postgresql://...' \
 *   LEVELS_SOURCE_DATABASE_URL='postgresql://...' \
 *   ASSETS_SOURCE_DATABASE_URL='postgresql://...' \
 *   node scripts/link-levels-assets.mjs
 *
 * Optional env:
 *   DATABASE_URL                fallback for TARGET_DATABASE_URL
 *   LEVELS_PROFILE_KEY          defaults to "default"
 *   ASSETS_ROW_ID               defaults to "asset-scheduler-main"
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function sslFor(url) {
  return String(url).includes('supabase.com') ? { rejectUnauthorized: false } : undefined;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v) {
  const n = toNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
}

function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toTimestampOrNull(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function prefixedId(prefix, rawId) {
  return `${prefix}:${String(rawId ?? crypto.randomUUID())}`;
}

function hashState(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

async function fetchLevelsState(client, profileKey) {
  const q = await client.query('select state from app_state where profile_key = $1 limit 1', [profileKey]);
  return q.rows[0]?.state ?? null;
}

async function fetchAssetsState(client, rowId) {
  const q = await client.query(
    'select events, subscriptions, assets, contacts, places, clothing from asset_scheduler_state where id = $1 limit 1',
    [rowId],
  );
  const row = q.rows[0];
  if (!row) return null;
  return {
    events: asArray(row.events),
    subscriptions: asArray(row.subscriptions),
    assets: asArray(row.assets),
    contacts: asArray(row.contacts),
    places: asArray(row.places),
    clothing: asArray(row.clothing),
  };
}

async function upsertSnapshot(target, source, sourceKey, state) {
  const stateHash = hashState(state);
  await target.query(
    `insert into integration_snapshots (source, source_key, state, state_hash)
     values ($1, $2, $3::jsonb, $4)
     on conflict (source, source_key, state_hash) do nothing`,
    [source, sourceKey, JSON.stringify(state), stateHash],
  );
}

async function upsertLevelsNormalized(target, levelsState) {
  const accounts = asArray(levelsState.accounts);
  const businesses = asArray(levelsState.businesses);
  const incomeEntries = asArray(levelsState.incomeEntries);
  const expenseEntries = asArray(levelsState.expenseEntries);
  const businessIncomeEntries = asArray(levelsState.businessIncomeEntries);
  const businessExpenseEntries = asArray(levelsState.businessExpenseEntries);

  for (const b of businesses) {
    const sourceId = String(b.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_businesses (id, source, source_id, name, fed_by_account_id, feeds_account_id, raw, updated_at)
       values ($1, 'levels', $2, $3, $4, $5, $6::jsonb, now())
       on conflict (id) do update set
         name = excluded.name,
         fed_by_account_id = excluded.fed_by_account_id,
         feeds_account_id = excluded.feeds_account_id,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('levels:business', sourceId),
        sourceId,
        String(b.name ?? ''),
        b.fedByAccountId ? prefixedId('levels:account', b.fedByAccountId) : null,
        b.feedsAccountId ? prefixedId('levels:account', b.feedsAccountId) : null,
        JSON.stringify(b),
      ],
    );
  }

  for (const a of accounts) {
    const sourceId = String(a.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_accounts (id, source, source_id, name, usage, balance, currency, feeds_account_id, raw, updated_at)
       values ($1, 'levels', $2, $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (id) do update set
         name = excluded.name,
         usage = excluded.usage,
         balance = excluded.balance,
         currency = excluded.currency,
         feeds_account_id = excluded.feeds_account_id,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('levels:account', sourceId),
        sourceId,
        String(a.name ?? ''),
        String(a.usage ?? ''),
        toNumberOrNull(a.balance),
        a.balanceCurrency ? String(a.balanceCurrency) : null,
        a.feedsAccountId ? prefixedId('levels:account', a.feedsAccountId) : null,
        JSON.stringify(a),
      ],
    );
  }

  for (const i of incomeEntries) {
    const sourceId = String(i.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_transactions (id, source, source_id, kind, amount, currency, occurred_on, account_id, note, raw, updated_at)
       values ($1, 'levels', $2, 'income', $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (id) do update set
         amount = excluded.amount,
         currency = excluded.currency,
         occurred_on = excluded.occurred_on,
         account_id = excluded.account_id,
         note = excluded.note,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('levels:income', sourceId),
        sourceId,
        toNumberOrNull(i.amount),
        i.currency ? String(i.currency) : null,
        toDateOrNull(i.date ?? i.earnedAt ?? i.occurredAt),
        i.accountId ? prefixedId('levels:account', i.accountId) : null,
        i.note ? String(i.note) : 'personal income',
        JSON.stringify(i),
      ],
    );
  }

  for (const e of expenseEntries) {
    const sourceId = String(e.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_transactions (id, source, source_id, kind, amount, currency, occurred_on, account_id, note, raw, updated_at)
       values ($1, 'levels', $2, 'expense', $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (id) do update set
         amount = excluded.amount,
         currency = excluded.currency,
         occurred_on = excluded.occurred_on,
         account_id = excluded.account_id,
         note = excluded.note,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('levels:expense', sourceId),
        sourceId,
        toNumberOrNull(e.amount),
        e.currency ? String(e.currency) : null,
        toDateOrNull(e.date ?? e.spentAt ?? e.occurredAt),
        e.accountId ? prefixedId('levels:account', e.accountId) : null,
        e.note ? String(e.note) : 'personal expense',
        JSON.stringify(e),
      ],
    );
  }

  for (const i of businessIncomeEntries) {
    const sourceId = String(i.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_transactions (id, source, source_id, kind, amount, currency, occurred_on, business_id, note, raw, updated_at)
       values ($1, 'levels', $2, 'business_income', $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (id) do update set
         amount = excluded.amount,
         currency = excluded.currency,
         occurred_on = excluded.occurred_on,
         business_id = excluded.business_id,
         note = excluded.note,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('levels:biz-income', sourceId),
        sourceId,
        toNumberOrNull(i.amount),
        i.currency ? String(i.currency) : null,
        toDateOrNull(i.earnedAt ?? i.date),
        i.businessId ? prefixedId('levels:business', i.businessId) : null,
        'business income',
        JSON.stringify(i),
      ],
    );
  }

  for (const e of businessExpenseEntries) {
    const sourceId = String(e.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_transactions (id, source, source_id, kind, amount, currency, occurred_on, business_id, note, raw, updated_at)
       values ($1, 'levels', $2, 'business_expense', $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (id) do update set
         amount = excluded.amount,
         currency = excluded.currency,
         occurred_on = excluded.occurred_on,
         business_id = excluded.business_id,
         note = excluded.note,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('levels:biz-expense', sourceId),
        sourceId,
        toNumberOrNull(e.amount),
        e.currency ? String(e.currency) : null,
        toDateOrNull(e.spentAt ?? e.date),
        e.businessId ? prefixedId('levels:business', e.businessId) : null,
        e.label ? String(e.label) : 'business expense',
        JSON.stringify(e),
      ],
    );
  }
}

async function upsertAssetsNormalized(target, assetsState) {
  const subscriptions = asArray(assetsState.subscriptions);
  const assets = asArray(assetsState.assets);
  const events = asArray(assetsState.events);

  for (const s of subscriptions) {
    const sourceId = String(s.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_subscriptions (id, source, source_id, name, cost, currency, status, usage_count, raw, updated_at)
       values ($1, 'assets', $2, $3, $4, 'USD', $5, $6, $7::jsonb, now())
       on conflict (id) do update set
         name = excluded.name,
         cost = excluded.cost,
         currency = excluded.currency,
         status = excluded.status,
         usage_count = excluded.usage_count,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('assets:subscription', sourceId),
        sourceId,
        String(s.name ?? ''),
        toNumberOrNull(s.cost),
        s.status ? String(s.status) : null,
        toIntOrNull(s.usageCount),
        JSON.stringify(s),
      ],
    );
  }

  for (const a of assets) {
    const sourceId = String(a.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_assets (id, source, source_id, name, category, condition, usage_count, raw, updated_at)
       values ($1, 'assets', $2, $3, $4, $5, $6, $7::jsonb, now())
       on conflict (id) do update set
         name = excluded.name,
         category = excluded.category,
         condition = excluded.condition,
         usage_count = excluded.usage_count,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('assets:item', sourceId),
        sourceId,
        String(a.name ?? ''),
        a.category ? String(a.category) : null,
        a.condition ? String(a.condition) : null,
        toIntOrNull(a.usageCount),
        JSON.stringify(a),
      ],
    );
  }

  for (const ev of events) {
    const sourceId = String(ev.id ?? crypto.randomUUID());
    await target.query(
      `insert into shared_work_items (id, source, source_id, title, status, start_at, end_at, note, raw, updated_at)
       values ($1, 'assets', $2, $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (id) do update set
         title = excluded.title,
         status = excluded.status,
         start_at = excluded.start_at,
         end_at = excluded.end_at,
         note = excluded.note,
         raw = excluded.raw,
         updated_at = now()`,
      [
        prefixedId('assets:event', sourceId),
        sourceId,
        String(ev.title ?? ev.name ?? 'Untitled work item'),
        ev.isRecurring ? 'recurring' : 'scheduled',
        toTimestampOrNull(ev.start),
        toTimestampOrNull(ev.end),
        ev.notes ? String(ev.notes) : null,
        JSON.stringify(ev),
      ],
    );
  }
}

async function main() {
  const targetUrl = process.env.TARGET_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  const levelsUrl = process.env.LEVELS_SOURCE_DATABASE_URL?.trim();
  const assetsUrl = process.env.ASSETS_SOURCE_DATABASE_URL?.trim();
  const levelsProfileKey = process.env.LEVELS_PROFILE_KEY?.trim() || 'default';
  const assetsRowId = process.env.ASSETS_ROW_ID?.trim() || 'asset-scheduler-main';

  if (!targetUrl || !levelsUrl || !assetsUrl) {
    console.error(
      'Missing database URL(s). Set TARGET_DATABASE_URL (or DATABASE_URL), LEVELS_SOURCE_DATABASE_URL, ASSETS_SOURCE_DATABASE_URL.',
    );
    process.exit(1);
  }

  const target = new Client({ connectionString: targetUrl, ssl: sslFor(targetUrl) });
  const levels = new Client({ connectionString: levelsUrl, ssl: sslFor(levelsUrl) });
  const assets = new Client({ connectionString: assetsUrl, ssl: sslFor(assetsUrl) });
  await Promise.all([target.connect(), levels.connect(), assets.connect()]);

  try {
    const sqlPath = path.join(root, 'db', 'init', '002_shared_bridge.sql');
    await target.query(fs.readFileSync(sqlPath, 'utf8'));

    const levelsState = await fetchLevelsState(levels, levelsProfileKey);
    const assetsState = await fetchAssetsState(assets, assetsRowId);
    if (!levelsState) throw new Error(`No Levels app_state found for profile_key=${levelsProfileKey}`);
    if (!assetsState) throw new Error(`No Assets asset_scheduler_state found for id=${assetsRowId}`);

    await target.query('begin');
    await upsertSnapshot(target, 'levels', levelsProfileKey, levelsState);
    await upsertSnapshot(target, 'assets', assetsRowId, assetsState);
    await upsertLevelsNormalized(target, levelsState);
    await upsertAssetsNormalized(target, assetsState);
    await target.query('commit');

    console.log('Linked Levels + Assets successfully.');
    console.log('Snapshots inserted (deduped by hash) and shared tables upserted.');
  } catch (err) {
    await target.query('rollback').catch(() => {});
    console.error('Link failed:', err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await Promise.all([target.end(), levels.end(), assets.end()]);
  }
}

await main();
