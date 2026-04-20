/**
 * Push Levels account bill lines tagged with `showInAssets` into the shared
 * `shared_subscriptions` table (same DB Assets uses for `/api/shared/finance`).
 *
 * @param {import('pg').Pool} sharedPool
 * @param {string} profileKey
 * @param {unknown} state
 */
export async function syncLevelsTaggedBillsToShared(sharedPool, profileKey, state) {
  if (!sharedPool || state == null || typeof state !== 'object') return

  const sys = typeof state.systemCurrency === 'string' ? state.systemCurrency : 'USD'
  const accounts = Array.isArray(state.accounts) ? state.accounts : []

  function parseMoney(s) {
    const n = parseFloat(String(s ?? '').replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }

  const client = await sharedPool.connect()
  try {
    await client.query('begin')
    await client.query(`delete from shared_subscriptions where source = 'levels' and id like $1`, [
      `levels:billsub:${profileKey}:%`,
    ])

    for (const acc of accounts) {
      const accId = String(acc?.id ?? '')
      if (!accId) continue
      const accName = typeof acc?.name === 'string' ? acc.name : ''
      const bills = Array.isArray(acc?.bills) ? acc.bills : []
      for (const bill of bills) {
        if (!bill || !bill.showInAssets) continue
        const billId = String(bill?.id ?? '')
        if (!billId) continue
        const id = `levels:billsub:${profileKey}:${accId}:${billId}`
        const sourceId = `${profileKey}:${accId}:${billId}`
        const name = String(bill?.label ?? '').trim() || 'Untitled bill'
        const cost = parseMoney(bill?.amount)
        const currency = typeof bill?.currency === 'string' && bill.currency ? bill.currency : sys
        const raw = {
          profileKey,
          accountId: accId,
          accountName: accName,
          bill,
          systemCurrency: sys,
        }
        await client.query(
          `insert into shared_subscriptions (id, source, source_id, name, cost, currency, status, usage_count, linked_business_id, raw, updated_at)
           values ($1, 'levels', $2, $3, $4, $5, 'active', 0, null, $6::jsonb, now())
           on conflict (id) do update set
             name = excluded.name,
             cost = excluded.cost,
             currency = excluded.currency,
             status = excluded.status,
             usage_count = excluded.usage_count,
             raw = excluded.raw,
             updated_at = now()`,
          [id, sourceId, name, cost, currency, JSON.stringify(raw)],
        )
      }
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
