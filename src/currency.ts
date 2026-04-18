/** USD-hub rates: 1 USD = rates[CODE] units of CODE (Frankfurter shape). */
export type UsdRates = Record<string, number>

export const CURRENCY_CODES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'CHF',
  'JPY',
  'SEK',
  'NOK',
  'NZD',
  'MXN',
  'SGD',
  'HKD',
  'PLN',
  'CNY',
  'INR',
  'KRW',
  'BRL',
] as const

/** Approximate fallback if the API is unavailable (USD base, same shape as Frankfurter). */
export const FALLBACK_USD_RATES: UsdRates = {
  USD: 1,
  CAD: 1.38,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.55,
  CHF: 0.88,
  JPY: 152,
  SEK: 10.5,
  NOK: 10.8,
  NZD: 1.68,
  MXN: 17.2,
  SGD: 1.35,
  HKD: 7.8,
  PLN: 4.0,
  CNY: 7.25,
  INR: 84,
  KRW: 1380,
  BRL: 5.45,
}

let cachedRates: UsdRates | null = null

export async function ensureRates(): Promise<UsdRates> {
  if (cachedRates) return cachedRates
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD')
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { rates: Record<string, number> }
    cachedRates = { USD: 1, ...data.rates }
    return cachedRates
  } catch {
    cachedRates = { ...FALLBACK_USD_RATES }
    return cachedRates
  }
}

export function getRatesSync(): UsdRates {
  return cachedRates ?? { USD: 1, ...FALLBACK_USD_RATES }
}

/** Convert amount from `from` currency to `to` using USD-hub rates. */
export function convertCross(amount: number, from: string, to: string, rates: UsdRates): number {
  if (!Number.isFinite(amount)) return 0
  if (from === to) return amount
  const r = rates
  const toUsd = (code: string, a: number): number => {
    if (code === 'USD') return a
    const rate = r[code]
    if (rate == null || !Number.isFinite(rate)) return a
    return a / rate
  }
  const fromUsd = (code: string, usd: number): number => {
    if (code === 'USD') return usd
    const rate = r[code]
    if (rate == null || !Number.isFinite(rate)) return usd
    return usd * rate
  }
  const usd = toUsd(from, amount)
  return fromUsd(to, usd)
}

export function formatMoneyCode(n: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currencyCode}`
  }
}

export function currencyOptionsHtml(selected: string): string {
  const labels: Record<string, string> = {
    USD: 'USD',
    CAD: 'CAD',
    EUR: 'EUR',
    GBP: 'GBP',
    AUD: 'AUD',
    CHF: 'CHF',
    JPY: 'JPY',
    SEK: 'SEK',
    NOK: 'NOK',
    NZD: 'NZD',
    MXN: 'MXN',
    SGD: 'SGD',
    HKD: 'HKD',
    PLN: 'PLN',
    CNY: 'CNY',
    INR: 'INR',
    KRW: 'KRW',
    BRL: 'BRL',
  }
  const sel = CURRENCY_CODES.includes(selected as (typeof CURRENCY_CODES)[number]) ? selected : 'USD'
  return CURRENCY_CODES.map(
    (code) =>
      `<option value="${code}"${code === sel ? ' selected' : ''}>${labels[code] ?? code}</option>`,
  ).join('')
}
