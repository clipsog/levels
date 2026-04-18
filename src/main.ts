import './style.css'
import {
  convertCross,
  currencyOptionsHtml,
  ensureRates,
  formatMoneyCode,
  getRatesSync,
  type UsdRates,
} from './currency'

const STORAGE_KEY = 'levels-finance-v2'
const APP_TAB_KEY = 'levels-app-tab'
const REMOTE_STATE_ENDPOINT = '/api/state'

type AppTab = 'management' | 'money-does'

/** `kind:id` or `kind:id:subId` — which row is expanded for editing */
let uiEdit: string | null = null

/** Main navigation: finance tools vs lifestyle map */
let appTab: AppTab = 'management'

const ICON_PEN = `<svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`

const ICON_X = `<svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`

const DAYS_PER_MONTH = 365 / 12
const WEEKS_PER_MONTH = 52 / 12

type IncomeSource = { id: string; name: string }

type IncomeEntry = {
  id: string
  sourceId: string
  amount: string
  currency: string
  accountId: string
  earnedAt: string
  /** Optional link to a "What the money does" card (set from Management). */
  moneyDoesCardId: string | null
}

/** @deprecated legacy load only */
type IncomeRow = { id: string; source: string; monthly: string; currency: string }

type ExpenseCategory = { id: string; name: string }

type ExpenseEntry = {
  id: string
  categoryId: string
  amount: string
  currency: string
  accountId: string
  spentAt: string
  /** Optional link to a "What the money does" card (set from Management). */
  moneyDoesCardId: string | null
}

type LevelCadence = 'once' | 'week' | 'month' | 'year'
type LevelScope = 'current' | 'target'

/** Car, house, jet, etc. — acquisition planning lives on an account. */
type AssetKind = 'car' | 'housing' | 'jet' | 'other'

type AcquisitionPath = 'full' | 'finance' | 'lease'

type AssetCostLine = {
  id: string
  label: string
  amount: string
  currency: string
  cadence: LevelCadence
  /** Now = paying or saving today · Next level = cost once you have the asset (e.g. payment, insurance, charging). */
  scope: LevelScope
}

/** Asset purchase plan tied to the account that will fund it (e.g. Desjardins for monthly spend + next car). */
type AccountAssetGoal = {
  id: string
  accountId: string
  assetKind: AssetKind
  name: string
  acquisitionPath: AcquisitionPath
  lines: AssetCostLine[]
}

type BillLine = {
  id: string
  label: string
  amount: string
  currency: string
  paid: boolean
  /** Optional link to a "What the money does" card (set from Management or that tab). */
  moneyDoesCardId: string | null
}

type DebtSettlingMode = 'deadline' | 'monthly'

type BankAccountRow = {
  id: string
  name: string
  usage: string
  balance: string
  balanceCurrency: string
  /** When set, this account exists to fund another account (e.g. move money for monthly payments). */
  feedsAccountId: string | null
  bills: BillLine[]
  /** Plan paying down debt from this account (amounts in system currency). */
  debtSettlingEnabled: boolean
  debtTotal: string
  debtMode: DebtSettlingMode
  /** Target date to be debt-free (YYYY-MM-DD) when mode is deadline. */
  debtDeadline: string | null
  /** Planned payment per month (system currency) when mode is monthly. */
  debtMonthlyPayment: string
}

type MoneyDoesCard = {
  id: string
  title: string
  subtitle: string
}

/** Side project / venture — ledger + which bank accounts fund it and receive from it. */
type BusinessRow = {
  id: string
  name: string
  /** Bank account money comes from into this business. */
  fedByAccountId: string | null
  /** Bank account this business sends money to. */
  feedsAccountId: string | null
}

type BusinessIncomeEntry = {
  id: string
  businessId: string
  amount: string
  currency: string
  earnedAt: string
}

type BusinessExpenseEntry = {
  id: string
  businessId: string
  amount: string
  currency: string
  spentAt: string
  label: string
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function emptyBill(inputCurrency: string): BillLine {
  return { id: uid(), label: '', amount: '', currency: inputCurrency, paid: false, moneyDoesCardId: null }
}

function seedMoneyDoesCards(): MoneyDoesCard[] {
  const card = (title: string, subtitle: string): MoneyDoesCard => ({
    id: uid(),
    title,
    subtitle,
  })
  return [
    card('Have fun', 'Play, recharge, enjoy.'),
    card('Invest in building businesses', 'Levels, Lucid, Scheduler stack.'),
    card('Market', 'Revenue engine.'),
    card("Manage it's time", 'Scheduler with Levels & Lucid — watch: timing, assets, goals, level.'),
    card('Make new connections', 'People and places.'),
    card('Travel', 'Where and why.'),
    card('Wander', 'Stories and worlds.'),
    card('Housing', 'Space for people you care about.'),
    card('Learn', 'Skills and knowledge.'),
    card('Rest', 'Switch off.'),
    card('Recover', 'Body maintenance.'),
    card('Maintenance', 'Health baseline.'),
    card('Look good, feel good', 'Wardrobe and presence.'),
    card("Buy back it's time", 'Hire so you can focus — e.g. job board.'),
    card('Romance', 'Connection.'),
    card('Give to a great cause / charity', 'Impact beyond you.'),
    card('Gift', 'For others.'),
    card('Clean', 'Spaces and vehicles.'),
  ]
}

function emptyAccount(systemCurrency: string): BankAccountRow {
  return {
    id: uid(),
    name: '',
    usage: '',
    balance: '',
    balanceCurrency: systemCurrency,
    feedsAccountId: null,
    bills: [emptyBill(systemCurrency)],
    debtSettlingEnabled: false,
    debtTotal: '',
    debtMode: 'deadline',
    debtDeadline: null,
    debtMonthlyPayment: '',
  }
}

type State = {
  systemCurrency: string
  accountAssetGoals: AccountAssetGoal[]
  incomeSources: IncomeSource[]
  incomeEntries: IncomeEntry[]
  expenseCategories: ExpenseCategory[]
  expenseEntries: ExpenseEntry[]
  accounts: BankAccountRow[]
  businesses: BusinessRow[]
  businessIncomeEntries: BusinessIncomeEntry[]
  businessExpenseEntries: BusinessExpenseEntry[]
  /** Lifestyle / priorities — what cash is for. */
  moneyDoesCards: MoneyDoesCard[]
}

function defaultState(): State {
  const sys = 'USD'
  return {
    systemCurrency: sys,
    accountAssetGoals: [],
    incomeSources: [{ id: uid(), name: '' }],
    incomeEntries: [],
    expenseCategories: [{ id: uid(), name: '' }],
    expenseEntries: [],
    accounts: [emptyAccount(sys)],
    businesses: [],
    businessIncomeEntries: [],
    businessExpenseEntries: [],
    moneyDoesCards: seedMoneyDoesCards(),
  }
}

function roundStored(n: number): string {
  if (!Number.isFinite(n) || n === 0) return ''
  const r = Math.round(n * 10000) / 10000
  return String(r)
}

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const legacyRaw = !raw ? localStorage.getItem('levels-finance-v1') : null
    const src = raw ?? legacyRaw
    if (!src) return defaultState()
    const parsed = JSON.parse(src) as Partial<State> & { income?: unknown[]; accounts?: unknown[] }
    const sys = typeof parsed.systemCurrency === 'string' ? parsed.systemCurrency : 'USD'

    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.map((r) => {
          const rawAcc = r as BankAccountRow & { bills?: unknown }
          const billRows = Array.isArray(rawAcc.bills)
            ? rawAcc.bills.map((b) => {
                const x = b as BillLine & { moneyDoesCardId?: unknown }
                const mid =
                  typeof x.moneyDoesCardId === 'string' && x.moneyDoesCardId ? x.moneyDoesCardId : null
                return {
                  id: typeof x.id === 'string' ? x.id : uid(),
                  label: String(x.label ?? ''),
                  amount: String(x.amount ?? ''),
                  currency: typeof x.currency === 'string' ? x.currency : sys,
                  paid: typeof x.paid === 'boolean' ? x.paid : false,
                  moneyDoesCardId: mid,
                }
              })
            : [emptyBill(sys)]
          const fid = rawAcc.feedsAccountId
          const dm = rawAcc.debtMode
          const ddl = rawAcc.debtDeadline
          return {
            id: typeof rawAcc.id === 'string' ? rawAcc.id : uid(),
            name: String(rawAcc.name ?? ''),
            usage: String(rawAcc.usage ?? ''),
            balance: String(rawAcc.balance ?? ''),
            balanceCurrency: typeof rawAcc.balanceCurrency === 'string' ? rawAcc.balanceCurrency : sys,
            feedsAccountId:
              typeof fid === 'string' && fid.length > 0 ? fid : null,
            bills: billRows.length ? billRows : [emptyBill(sys)],
            debtSettlingEnabled: typeof rawAcc.debtSettlingEnabled === 'boolean' ? rawAcc.debtSettlingEnabled : false,
            debtTotal: String(rawAcc.debtTotal ?? ''),
            debtMode: dm === 'monthly' || dm === 'deadline' ? dm : 'deadline',
            debtDeadline:
              typeof ddl === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ddl) ? ddl : null,
            debtMonthlyPayment: String(rawAcc.debtMonthlyPayment ?? ''),
          }
        })
      : defaultState().accounts

    const accountIds = new Set(accounts.map((a) => a.id))
    accounts.forEach((a) => {
      if (a.feedsAccountId && (!accountIds.has(a.feedsAccountId) || a.feedsAccountId === a.id)) {
        a.feedsAccountId = null
      }
    })

    const ext = parsed as Partial<State> & { income?: unknown[] }
    const legacyExp = parsed as Record<string, unknown>
    let incomeSources: IncomeSource[]
    let incomeEntries: IncomeEntry[]
    let expenseCategories: ExpenseCategory[]
    let expenseEntries: ExpenseEntry[]

    if (Array.isArray(ext.incomeSources) && Array.isArray(ext.incomeEntries)) {
      incomeSources = ext.incomeSources.map((s) => {
        const x = s as IncomeSource
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          name: String(x.name ?? ''),
        }
      })
      incomeEntries = ext.incomeEntries.map((e) => {
        const x = e as IncomeEntry & { moneyDoesCardId?: unknown }
        const d = x.earnedAt
        const mid =
          typeof x.moneyDoesCardId === 'string' && x.moneyDoesCardId ? x.moneyDoesCardId : null
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          sourceId: String(x.sourceId ?? ''),
          amount: String(x.amount ?? ''),
          currency: typeof x.currency === 'string' ? x.currency : sys,
          accountId: String(x.accountId ?? ''),
          earnedAt:
            typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
              ? d
              : new Date().toISOString().slice(0, 10),
          moneyDoesCardId: mid,
        }
      })
    } else if (Array.isArray(ext.income)) {
      incomeSources = []
      incomeEntries = []
      const legacy = ext.income as IncomeRow[]
      const firstAcc = accounts[0]?.id ?? ''
      legacy.forEach((x) => {
        const sid = typeof x.id === 'string' ? x.id : uid()
        const name = String(x.source ?? '').trim()
        const m = parseMoney(String(x.monthly ?? ''))
        if (!name && m <= 0) return
        incomeSources.push({ id: sid, name: name || 'Income' })
        if (m > 0) {
          incomeEntries.push({
            id: uid(),
            sourceId: sid,
            amount: String(x.monthly ?? ''),
            currency: typeof x.currency === 'string' ? x.currency : sys,
            accountId: firstAcc,
            earnedAt: new Date().toISOString().slice(0, 10),
            moneyDoesCardId: null,
          })
        }
      })
      if (incomeSources.length === 0) incomeSources = [{ id: uid(), name: '' }]
    } else {
      incomeSources = defaultState().incomeSources
      incomeEntries = defaultState().incomeEntries
    }

    const sourceIds = new Set(incomeSources.map((s) => s.id))
    incomeEntries.forEach((e) => {
      if (!e.sourceId || !sourceIds.has(e.sourceId)) {
        e.sourceId = incomeSources[0]?.id ?? ''
      }
      if (!e.accountId || !accountIds.has(e.accountId)) e.accountId = accounts[0]?.id ?? ''
    })

    if (Array.isArray(ext.expenseCategories) && Array.isArray(ext.expenseEntries)) {
      expenseCategories = ext.expenseCategories.map((c) => {
        const x = c as ExpenseCategory
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          name: String(x.name ?? ''),
        }
      })
      expenseEntries = ext.expenseEntries.map((e) => {
        const x = e as ExpenseEntry & { moneyDoesCardId?: unknown }
        const d = x.spentAt
        const mid =
          typeof x.moneyDoesCardId === 'string' && x.moneyDoesCardId ? x.moneyDoesCardId : null
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          categoryId: String(x.categoryId ?? ''),
          amount: String(x.amount ?? ''),
          currency: typeof x.currency === 'string' ? x.currency : sys,
          accountId: String(x.accountId ?? ''),
          spentAt:
            typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
              ? d
              : new Date().toISOString().slice(0, 10),
          moneyDoesCardId: mid,
        }
      })
    } else {
      const legD = parseMoney(String(legacyExp.daily ?? ''))
      const legW = parseMoney(String(legacyExp.weekly ?? ''))
      const legM = parseMoney(String(legacyExp.monthly ?? ''))
      const legY = parseMoney(String(legacyExp.yearly ?? ''))
      const legacyMonthly = legD * DAYS_PER_MONTH + legW * WEEKS_PER_MONTH + legM + legY / 12
      expenseCategories = [{ id: uid(), name: '' }]
      expenseEntries = []
      if (legacyMonthly > 0) {
        const catId = uid()
        expenseCategories = [{ id: catId, name: 'Migrated (old expense form)' }]
        expenseEntries.push({
          id: uid(),
          categoryId: catId,
          amount: roundStored(legacyMonthly),
          currency: sys,
          accountId: accounts[0]?.id ?? '',
          spentAt: new Date().toISOString().slice(0, 10),
          moneyDoesCardId: null,
        })
      }
    }

    const categoryIds = new Set(expenseCategories.map((c) => c.id))
    expenseEntries.forEach((e) => {
      if (!e.categoryId || !categoryIds.has(e.categoryId)) {
        e.categoryId = expenseCategories[0]?.id ?? ''
      }
      if (!e.accountId || !accountIds.has(e.accountId)) e.accountId = accounts[0]?.id ?? ''
    })

    const parseCadence = (x: unknown): LevelCadence =>
      x === 'once' || x === 'week' || x === 'month' || x === 'year' ? x : 'month'
    const parseScope = (x: unknown): LevelScope => (x === 'current' ? 'current' : 'target')
    const parseAssetKind = (x: unknown): AssetKind =>
      x === 'car' || x === 'housing' || x === 'jet' || x === 'other' ? x : 'other'
    const parsePath = (x: unknown): AcquisitionPath =>
      x === 'full' || x === 'finance' || x === 'lease' ? x : 'finance'

    let accountAssetGoals: AccountAssetGoal[]

    if (Array.isArray(ext.accountAssetGoals)) {
      accountAssetGoals = ext.accountAssetGoals.map((raw) => {
        const x = raw as AccountAssetGoal & { lines?: unknown }
        const linesRaw = Array.isArray(x.lines) ? x.lines : []
        const lines: AssetCostLine[] = linesRaw.map((ln) => {
          const L = ln as AssetCostLine
          return {
            id: typeof L.id === 'string' ? L.id : uid(),
            label: String(L.label ?? ''),
            amount: String(L.amount ?? ''),
            currency: typeof L.currency === 'string' ? L.currency : sys,
            cadence: parseCadence(L.cadence),
            scope: parseScope(L.scope),
          }
        })
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          accountId: String(x.accountId ?? ''),
          assetKind: parseAssetKind(x.assetKind),
          name: String(x.name ?? ''),
          acquisitionPath: parsePath(x.acquisitionPath),
          lines,
        }
      })
    } else {
      const legacy = ext as Record<string, unknown>
      const oldPillars = legacy.levelPillars
      const oldGoals = legacy.levelGoals
      const oldLines = legacy.levelLineItems
      if (Array.isArray(oldPillars) && Array.isArray(oldGoals) && Array.isArray(oldLines)) {
        accountAssetGoals = []
        const firstAcc = accounts[0]?.id ?? ''
        type LegacyGoal = { id?: string; name?: string }
        type LegacyLine = {
          id?: string
          goalId?: string
          label?: string
          amount?: string
          currency?: string
          cadence?: unknown
          scope?: unknown
        }
        for (const g of oldGoals as LegacyGoal[]) {
          const gid = typeof g.id === 'string' ? g.id : uid()
          const linesForGoal = (oldLines as LegacyLine[])
            .filter((l) => l.goalId === gid)
            .map((l) => ({
              id: typeof l.id === 'string' ? l.id : uid(),
              label: String(l.label ?? ''),
              amount: String(l.amount ?? ''),
              currency: typeof l.currency === 'string' ? l.currency : sys,
              cadence: parseCadence(l.cadence),
              scope: parseScope(l.scope),
            }))
          accountAssetGoals.push({
            id: uid(),
            accountId: firstAcc,
            assetKind: 'other',
            name: String(g.name ?? '').trim() || 'Imported goal',
            acquisitionPath: 'finance',
            lines: linesForGoal,
          })
        }
      } else {
        accountAssetGoals = []
      }
    }

    const accIdsForGoals = new Set(accounts.map((a) => a.id))
    accountAssetGoals.forEach((g) => {
      if (!g.accountId || !accIdsForGoals.has(g.accountId)) g.accountId = accounts[0]?.id ?? ''
    })

    let businesses: BusinessRow[] = []
    if (Array.isArray((ext as Partial<State>).businesses)) {
      businesses = ((ext as Partial<State>).businesses as BusinessRow[]).map((raw) => {
        const x = raw as BusinessRow
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          name: String(x.name ?? ''),
          fedByAccountId:
            typeof x.fedByAccountId === 'string' && x.fedByAccountId.length > 0 ? x.fedByAccountId : null,
          feedsAccountId:
            typeof x.feedsAccountId === 'string' && x.feedsAccountId.length > 0 ? x.feedsAccountId : null,
        }
      })
    }
    const businessIds = new Set(businesses.map((b) => b.id))
    businesses.forEach((b) => {
      if (b.fedByAccountId && !accountIds.has(b.fedByAccountId)) b.fedByAccountId = null
      if (b.feedsAccountId && !accountIds.has(b.feedsAccountId)) b.feedsAccountId = null
      if (b.fedByAccountId && b.feedsAccountId && b.fedByAccountId === b.feedsAccountId) b.feedsAccountId = null
    })

    let businessIncomeEntries: BusinessIncomeEntry[] = []
    if (Array.isArray((ext as Partial<State>).businessIncomeEntries)) {
      businessIncomeEntries = (
        (ext as Partial<State>).businessIncomeEntries as BusinessIncomeEntry[]
      ).map((e) => {
        const x = e as BusinessIncomeEntry
        const d = x.earnedAt
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          businessId: String(x.businessId ?? ''),
          amount: String(x.amount ?? ''),
          currency: typeof x.currency === 'string' ? x.currency : sys,
          earnedAt:
            typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
              ? d
              : new Date().toISOString().slice(0, 10),
        }
      })
    }
    businessIncomeEntries = businessIncomeEntries.filter((e) => businessIds.has(e.businessId))

    let businessExpenseEntries: BusinessExpenseEntry[] = []
    if (Array.isArray((ext as Partial<State>).businessExpenseEntries)) {
      businessExpenseEntries = (
        (ext as Partial<State>).businessExpenseEntries as BusinessExpenseEntry[]
      ).map((e) => {
        const x = e as BusinessExpenseEntry
        const d = x.spentAt
        return {
          id: typeof x.id === 'string' ? x.id : uid(),
          businessId: String(x.businessId ?? ''),
          amount: String(x.amount ?? ''),
          currency: typeof x.currency === 'string' ? x.currency : sys,
          spentAt:
            typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
              ? d
              : new Date().toISOString().slice(0, 10),
          label: String(x.label ?? ''),
        }
      })
    }
    businessExpenseEntries = businessExpenseEntries.filter((e) => businessIds.has(e.businessId))

    let moneyDoesCards: MoneyDoesCard[] = []
    if (Array.isArray((ext as Partial<State>).moneyDoesCards)) {
      moneyDoesCards = ((ext as Partial<State>).moneyDoesCards as MoneyDoesCard[]).map((raw) => {
        const c = raw as MoneyDoesCard
        return {
          id: typeof c.id === 'string' ? c.id : uid(),
          title: String(c.title ?? ''),
          subtitle: String(c.subtitle ?? ''),
        }
      })
    } else {
      moneyDoesCards = seedMoneyDoesCards()
    }

    const moneyDoesIds = new Set(moneyDoesCards.map((c) => c.id))
    expenseEntries.forEach((e) => {
      if (e.moneyDoesCardId && !moneyDoesIds.has(e.moneyDoesCardId)) e.moneyDoesCardId = null
    })
    incomeEntries.forEach((e) => {
      if (e.moneyDoesCardId && !moneyDoesIds.has(e.moneyDoesCardId)) e.moneyDoesCardId = null
    })
    accounts.forEach((acc) => {
      acc.bills.forEach((b) => {
        if (b.moneyDoesCardId && !moneyDoesIds.has(b.moneyDoesCardId)) b.moneyDoesCardId = null
      })
    })

    return {
      systemCurrency: sys,
      accountAssetGoals,
      incomeSources: incomeSources.length ? incomeSources : defaultState().incomeSources,
      incomeEntries,
      expenseCategories: expenseCategories.length ? expenseCategories : defaultState().expenseCategories,
      expenseEntries,
      accounts: accounts.length ? accounts : defaultState().accounts,
      businesses,
      businessIncomeEntries,
      businessExpenseEntries,
      moneyDoesCards,
    }
  } catch {
    return defaultState()
  }
}

function saveState(s: State): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  debouncedRemoteSave()
}

async function saveStateRemote(s: State): Promise<void> {
  try {
    await fetch(REMOTE_STATE_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: s }),
    })
  } catch {
    /* keep localStorage as fallback when API is unavailable */
  }
}

async function hydrateStateFromRemote(): Promise<void> {
  try {
    const res = await fetch(REMOTE_STATE_ENDPOINT, { method: 'GET' })
    if (!res.ok) return
    const payload = (await res.json()) as { state?: unknown }
    if (!payload || payload.state == null || typeof payload.state !== 'object') return
    /** New DB rows often use `{}`; do not replace a populated local snapshot with that. */
    if (Array.isArray(payload.state) || Object.keys(payload.state as object).length === 0) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.state))
    state = loadState()
    render()
  } catch {
    /* ignore when server is down; local mode still works */
  }
}

function parseMoney(s: string): number {
  const n = parseFloat(s.replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function formatMoney(n: number): string {
  return formatMoneyCode(n, state.systemCurrency)
}

function billAmountSys(b: BillLine): number {
  return parseMoney(b.amount)
}

function sumBillLineAmounts(acc: BankAccountRow, pred: (b: BillLine) => boolean): number {
  return acc.bills.reduce((sum, b) => {
    const n = billAmountSys(b)
    if (n <= 0) return sum
    return pred(b) ? sum + n : sum
  }, 0)
}

function accountListedTotal(acc: BankAccountRow): number {
  return sumBillLineAmounts(acc, () => true)
}

function accountPaidTotal(acc: BankAccountRow): number {
  return sumBillLineAmounts(acc, (b) => b.paid)
}

function accountUnpaidTotal(acc: BankAccountRow): number {
  return sumBillLineAmounts(acc, (b) => !b.paid)
}

/** Money still needed inside this account to cover unpaid bills (system currency). */
function needInAccount(acc: BankAccountRow): number {
  return Math.max(0, accountUnpaidTotal(acc) - parseMoney(acc.balance))
}

function feedersOf(receiverId: string): BankAccountRow[] {
  return state.accounts.filter((a) => a.feedsAccountId === receiverId && a.id !== receiverId)
}

function feederLiquiditySum(receiverId: string): number {
  return feedersOf(receiverId).reduce((s, f) => s + parseMoney(f.balance), 0)
}

/**
 * How much is taken from each feeder when moving `takeTotal` from the feeder pool,
 * in account list order (drain earlier feeders first).
 */
function feederBalancesAfterTransfer(
  inbound: BankAccountRow[],
  takeTotal: number,
): { name: string; take: number; remainingAfter: number }[] {
  let rem = takeTotal
  return inbound.map((f) => {
    const bal = parseMoney(f.balance)
    if (rem <= 0) {
      return { name: accountDisplayName(f), take: 0, remainingAfter: bal }
    }
    const take = Math.min(bal, rem)
    rem -= take
    return { name: accountDisplayName(f), take, remainingAfter: bal - take }
  })
}

function feederRemainingAfterMoveSentence(
  rows: { name: string; take: number; remainingAfter: number }[],
  sys: string,
): string {
  if (rows.length === 0) return ''
  const parts = rows.map((r) => {
    if (r.take <= 0) {
      return `${r.name} unchanged (${formatMoneyCode(r.remainingAfter, sys)})`
    }
    return `${r.name} would have ${formatMoneyCode(r.remainingAfter, sys)} left after moving ${formatMoneyCode(r.take, sys)} from it`
  })
  if (parts.length === 1) return parts[0] + '.'
  const last = parts.pop()!
  return parts.join('; ') + '; and ' + last + '.'
}

function accountDisplayName(acc: BankAccountRow): string {
  const n = acc.name.trim()
  return n || 'Unnamed account'
}

/** Stable hue 0–359 from an id (accent borders / tints). */
function accentHueFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return Math.abs(h) % 360
}

/** Accounts in the same undirected feed graph (feeds ↔ fed) render in one cluster. */
function groupAccountsByFeedChain(accounts: BankAccountRow[]): BankAccountRow[][] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const adj = new Map<string, Set<string>>()
  for (const a of accounts) {
    if (!adj.has(a.id)) adj.set(a.id, new Set())
    const t = a.feedsAccountId
    if (t && byId.has(t) && t !== a.id) {
      adj.get(a.id)!.add(t)
      if (!adj.has(t)) adj.set(t, new Set())
      adj.get(t)!.add(a.id)
    }
  }
  const seen = new Set<string>()
  const groups: BankAccountRow[][] = []
  for (const a of accounts) {
    if (seen.has(a.id)) continue
    const stack: string[] = [a.id]
    seen.add(a.id)
    const comp: BankAccountRow[] = []
    while (stack.length) {
      const id = stack.pop()!
      const acc = byId.get(id)
      if (acc) comp.push(acc)
      for (const n of adj.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    groups.push(comp)
  }
  return groups
}

function clusterHue(group: BankAccountRow[]): number {
  if (group.length === 0) return 200
  const sum = group.reduce((s, a) => s + accentHueFromId(a.id), 0)
  return Math.round(sum / group.length) % 360
}

function accountCardAccentStyle(id: string): string {
  return `--account-h:${accentHueFromId(id)};`
}

function rowTintStyle(id: string): string {
  return `--row-h:${accentHueFromId(id)};`
}

function feedCycleWarning(acc: BankAccountRow): string | null {
  const seen = new Set<string>()
  let cur: string | null = acc.feedsAccountId
  while (cur) {
    if (seen.has(cur)) return 'This feed link is part of a loop. Clear one of the links to fix the chain.'
    seen.add(cur)
    const next = state.accounts.find((a) => a.id === cur)
    cur = next?.feedsAccountId ?? null
  }
  return null
}

function accountFeedInsightsHtml(acc: BankAccountRow): string {
  const sys = state.systemCurrency
  const parts: string[] = []
  const cycle = feedCycleWarning(acc)
  if (cycle) {
    parts.push(`<p class="feed-insight-warn">${escapeHtml(cycle)}</p>`)
  }

  const target = acc.feedsAccountId
    ? state.accounts.find((a) => a.id === acc.feedsAccountId)
    : null
  if (acc.feedsAccountId && target && target.id !== acc.id) {
    const need = needInAccount(target)
    const myBal = parseMoney(acc.balance)
    const allLiquidity = feederLiquiditySum(target.id)
    const canMoveTotal = Math.min(allLiquidity, need)
    const stillAfter = Math.max(0, need - canMoveTotal)
    const myCap = Math.min(myBal, need)
    const tn = accountDisplayName(target)
    parts.push(`<div class="feed-insight feed-insight--out">
      <div class="feed-insight-title">Feeds → ${escapeHtml(tn)}</div>
      <p class="feed-insight-text">${escapeHtml(tn)} needs <strong>${formatMoneyCode(need, sys)}</strong> more in that account (unpaid bills minus balance there).</p>
      <ul class="feed-insight-list">
        <li>Balance in <em>this</em> account: <strong>${formatMoneyCode(myBal, sys)}</strong> — you can move up to <strong>${formatMoneyCode(myCap, sys)}</strong> toward that gap.</li>
        <li>All accounts feeding ${escapeHtml(tn)} hold <strong>${formatMoneyCode(allLiquidity, sys)}</strong> total; together they can cover up to <strong>${formatMoneyCode(canMoveTotal, sys)}</strong> of the gap.</li>
        <li>Still to find elsewhere (income, other accounts): <strong>${formatMoneyCode(stillAfter, sys)}</strong></li>
      </ul>
    </div>`)
  }

  const inbound = feedersOf(acc.id)
  if (inbound.length > 0) {
    const need = needInAccount(acc)
    const sumBal = feederLiquiditySum(acc.id)
    const canCover = Math.min(sumBal, need)
    const still = Math.max(0, need - canCover)
    const names = inbound.map((f) => accountDisplayName(f)).join(', ')
    parts.push(`<div class="feed-insight feed-insight--in">
      <div class="feed-insight-title">Fed by</div>
      <p class="feed-insight-text">${escapeHtml(names)}</p>
      <ul class="feed-insight-list">
        <li>Shortfall here (unpaid − balance): <strong>${formatMoneyCode(need, sys)}</strong></li>
        <li>Combined balance in feeder accounts: <strong>${formatMoneyCode(sumBal, sys)}</strong> → up to <strong>${formatMoneyCode(canCover, sys)}</strong> could be moved in to cover the gap.</li>
        <li>Still needed from outside (earnings, transfers): <strong>${formatMoneyCode(still, sys)}</strong></li>
      </ul>
    </div>`)
  }

  if (parts.length === 0) {
    return `<div class="account-feed-wrap account-feed-wrap--empty" data-feed-insights="${escapeAttr(acc.id)}"></div>`
  }
  return `<div class="account-feed-wrap" data-feed-insights="${escapeAttr(acc.id)}">${parts.join('')}</div>`
}

function refreshAllFeedInsights(): void {
  state.accounts.forEach((acc) => {
    const el = app.querySelector(`[data-feed-insights="${acc.id}"]`)
    if (el) el.outerHTML = accountFeedInsightsHtml(acc)
  })
}

function feedsTargetOptionsHtml(currentId: string, selectedTargetId: string | null): string {
  const opts = state.accounts
    .filter((a) => a.id !== currentId)
    .map(
      (a) =>
        `<option value="${escapeAttr(a.id)}"${selectedTargetId === a.id ? ' selected' : ''}>${escapeHtml(accountDisplayName(a))}</option>`,
    )
    .join('')
  const noneSel = selectedTargetId == null || selectedTargetId === '' ? ' selected' : ''
  return `<option value=""${noneSel}>— None —</option>${opts}`
}

/** Bank account picker with optional none (for business fed-by / feeds). */
function businessAccountSelectHtml(selectedId: string | null): string {
  const noneSel = selectedId == null || selectedId === '' ? ' selected' : ''
  const opts = state.accounts
    .map(
      (a) =>
        `<option value="${escapeAttr(a.id)}"${selectedId === a.id ? ' selected' : ''}>${escapeHtml(accountDisplayName(a))}</option>`,
    )
    .join('')
  return `<option value=""${noneSel}>— None —</option>${opts}`
}

function businessNameRowHtml(b: BusinessRow): string {
  const key = `business-meta:${b.id}`
  const editing = uiEdit === key
  const display = b.name.trim() || 'Untitled business'
  const tint = `style="${rowTintStyle(b.id)}"`
  if (editing) {
    return `<div class="entity-row entity-row--edit business-name-row entity-row--tinted" ${tint}>
      <div class="field field--grow" style="margin:0">
        <label class="entity-label">Business name</label>
        <input type="text" data-business-name data-id="${escapeAttr(b.id)}" placeholder="e.g. Side LLC, consulting" value="${escapeAttr(b.name)}" autocomplete="off" />
      </div>
      <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
    </div>`
  }
  return `<div class="entity-row entity-row--view business-name-row entity-row--tinted" ${tint}>
    <span class="entity-row__text">${escapeHtml(display)}</span>
    <div class="entity-row__actions">
      <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
      <button type="button" class="icon-btn icon-btn--danger" data-remove-business="${escapeAttr(b.id)}" aria-label="Delete business">${ICON_X}</button>
    </div>
  </div>`
}

function businessCardHtml(b: BusinessRow, sys: string, rates: UsdRates, today: string): string {
  const fedOpts = businessAccountSelectHtml(b.fedByAccountId)
  const feedsOpts = businessAccountSelectHtml(b.feedsAccountId)
  const incomes = state.businessIncomeEntries
    .filter((e) => e.businessId === b.id)
    .sort((a, c) => c.earnedAt.localeCompare(a.earnedAt) || c.id.localeCompare(a.id))
  const expenses = state.businessExpenseEntries
    .filter((e) => e.businessId === b.id)
    .sort((a, c) => c.spentAt.localeCompare(a.spentAt) || c.id.localeCompare(a.id))

  const incRows = incomes
    .map((e) => {
      const disp = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
      return `<tr>
        <td>${escapeHtml(e.earnedAt)}</td>
        <td class="business-ledger-amt">${escapeHtml(formatMoneyCode(disp, e.currency))}</td>
        <td class="history-row-actions">
          <button type="button" class="icon-btn icon-btn--danger" data-remove-business-income="${escapeAttr(e.id)}" aria-label="Delete">${ICON_X}</button>
        </td>
      </tr>`
    })
    .join('')

  const expRows = expenses
    .map((e) => {
      const disp = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
      return `<tr>
        <td>${escapeHtml(e.spentAt)}</td>
        <td>${escapeHtml(e.label.trim() || '—')}</td>
        <td class="business-ledger-amt">${escapeHtml(formatMoneyCode(disp, e.currency))}</td>
        <td class="history-row-actions">
          <button type="button" class="icon-btn icon-btn--danger" data-remove-business-expense="${escapeAttr(e.id)}" aria-label="Delete">${ICON_X}</button>
        </td>
      </tr>`
    })
    .join('')

  return `
    <div class="business-card" data-business-card="${escapeAttr(b.id)}" style="${accountCardAccentStyle(b.id)}">
      ${businessNameRowHtml(b)}
      <div class="business-feed-fields">
        <div class="field">
          <label for="biz-fed-${escapeAttr(b.id)}">Fed by account</label>
          <select id="biz-fed-${escapeAttr(b.id)}" class="feed-target-select" data-business-fed-by data-id="${escapeAttr(b.id)}" aria-label="Account that funds this business">${fedOpts}</select>
        </div>
        <div class="field">
          <label for="biz-feeds-${escapeAttr(b.id)}">Feeds account</label>
          <select id="biz-feeds-${escapeAttr(b.id)}" class="feed-target-select" data-business-feeds data-id="${escapeAttr(b.id)}" aria-label="Account this business sends money to">${feedsOpts}</select>
        </div>
      </div>
      <p class="business-feed-hint hint-inline">Link optional bank accounts: cash <strong>in</strong> from “Fed by” and <strong>out</strong> to “Feeds” (for your own planning).</p>

      <div class="business-ledger">
        <h4 class="business-ledger-title">Business income</h4>
        <div class="business-log-form business-log-form--income">
          <div class="field money-field">
            <label>Amount</label>
            <div class="money-input-row">
              <input type="number" data-biz-inc-amt data-bid="${escapeAttr(b.id)}" inputmode="decimal" min="0" step="any" placeholder="0" />
              <select class="currency-select" data-biz-inc-cur data-bid="${escapeAttr(b.id)}" aria-label="Currency">${currencyOptionsHtml(sys)}</select>
            </div>
          </div>
          <div class="field">
            <label>Date</label>
            <input type="date" data-biz-inc-date data-bid="${escapeAttr(b.id)}" value="${escapeAttr(today)}" />
          </div>
          <button type="button" class="add-btn add-btn--nested" data-biz-inc-add="${escapeAttr(b.id)}">Add income</button>
        </div>
        <div class="business-history-wrap">
          ${
            incRows.length
              ? `<table class="business-ledger-table" aria-label="Business income"><thead><tr><th>Date</th><th>Amount</th><th></th></tr></thead><tbody>${incRows}</tbody></table>`
              : '<p class="hint-inline business-ledger-empty">No business income yet.</p>'
          }
        </div>
      </div>

      <div class="business-ledger">
        <h4 class="business-ledger-title">Business expenses</h4>
        <div class="business-log-form business-log-form--expense">
          <div class="field">
            <label>Note</label>
            <input type="text" data-biz-exp-label data-bid="${escapeAttr(b.id)}" placeholder="e.g. Software, ads" autocomplete="off" />
          </div>
          <div class="field money-field">
            <label>Amount</label>
            <div class="money-input-row">
              <input type="number" data-biz-exp-amt data-bid="${escapeAttr(b.id)}" inputmode="decimal" min="0" step="any" placeholder="0" />
              <select class="currency-select" data-biz-exp-cur data-bid="${escapeAttr(b.id)}" aria-label="Currency">${currencyOptionsHtml(sys)}</select>
            </div>
          </div>
          <div class="field">
            <label>Date</label>
            <input type="date" data-biz-exp-date data-bid="${escapeAttr(b.id)}" value="${escapeAttr(today)}" />
          </div>
          <button type="button" class="add-btn add-btn--nested" data-biz-exp-add="${escapeAttr(b.id)}">Add expense</button>
        </div>
        <div class="business-history-wrap">
          ${
            expRows.length
              ? `<table class="business-ledger-table" aria-label="Business expenses"><thead><tr><th>Date</th><th>Note</th><th>Amount</th><th></th></tr></thead><tbody>${expRows}</tbody></table>`
              : '<p class="hint-inline business-ledger-empty">No business expenses yet.</p>'
          }
        </div>
      </div>
    </div>`
}

function patchAccountTracker(accId: string): void {
  const acc = state.accounts.find((a) => a.id === accId)
  const el = app.querySelector(`[data-account-tracker="${accId}"]`)
  if (!acc || !el) return
  el.outerHTML = accountTrackerBlock(acc)
}

/** When a feeder account balance changes, the account it feeds may need the same tracker refresh. */
function patchAccountTrackerAndFeedTarget(accId: string): void {
  patchAccountTracker(accId)
  const row = state.accounts.find((a) => a.id === accId)
  const targetId = row?.feedsAccountId
  if (targetId && targetId !== accId) patchAccountTracker(targetId)
}

function accountTrackerBlock(acc: BankAccountRow): string {
  const sys = state.systemCurrency
  const listed = accountListedTotal(acc)
  const paid = accountPaidTotal(acc)
  const unpaid = accountUnpaidTotal(acc)
  const balance = parseMoney(acc.balance)
  const afterUnpaid = balance - unpaid
  const shortBy = unpaid - balance

  const inbound = feedersOf(acc.id)
  const feederSum = inbound.length > 0 ? feederLiquiditySum(acc.id) : 0
  const need = Math.max(0, unpaid - balance)
  const canCoverFromFeeders = inbound.length > 0 && need > 0 ? Math.min(feederSum, need) : 0
  const effectiveTowardUnpaid = balance + canCoverFromFeeders
  const afterUnpaidWithFeeders = effectiveTowardUnpaid - unpaid
  const feederNames = inbound.map((f) => accountDisplayName(f)).join(', ')
  const feederAfterRows =
    canCoverFromFeeders > 0 ? feederBalancesAfterTransfer(inbound, canCoverFromFeeders) : []
  const feederFollowUpText =
    unpaid > 0 && balance < unpaid && canCoverFromFeeders > 0
      ? feederRemainingAfterMoveSentence(feederAfterRows, sys)
      : ''

  let statusClass = 'account-tracker-status--neutral'
  let statusText: string
  if (listed <= 0 && balance === 0) {
    statusText = 'Add bill amounts and a balance to see if you are on track.'
  } else if (unpaid <= 0) {
    statusClass = 'account-tracker-status--ok'
    statusText = 'All listed bills are marked paid for this period.'
  } else if (balance >= unpaid) {
    statusClass = 'account-tracker-status--ok'
    statusText = `On track — balance covers what is still unpaid; about ${formatMoneyCode(afterUnpaid, sys)} would remain afterward.`
    if (inbound.length > 0 && feederSum > 0) {
      statusText += ` Feeder account${inbound.length > 1 ? 's' : ''} (${feederNames}) ${inbound.length > 1 ? 'hold' : 'holds'} ${formatMoneyCode(feederSum, sys)} you could still move in if useful.`
    }
  } else if (inbound.length > 0 && canCoverFromFeeders >= need) {
    statusClass = 'account-tracker-status--ok'
    statusText = `On track if you move up to ${formatMoneyCode(need, sys)} from ${feederNames} into this account (${formatMoneyCode(feederSum, sys)} available there). Together with this balance, unpaid bills are covered; about ${formatMoneyCode(Math.max(0, afterUnpaidWithFeeders), sys)} would remain here afterward.`
  } else if (inbound.length > 0) {
    const stillAfterFeeders = Math.max(0, need - canCoverFromFeeders)
    statusClass = 'account-tracker-status--warn'
    if (feederSum <= 0) {
      statusText = `About ${formatMoneyCode(shortBy, sys)} more is needed to cover unpaid bills. Feeder account${inbound.length > 1 ? 's' : ''} (${feederNames}) ${inbound.length > 1 ? 'show' : 'shows'} $0 — add funds there or elsewhere.`
    } else {
      statusText = `This balance plus up to ${formatMoneyCode(canCoverFromFeeders, sys)} from ${feederNames} (${formatMoneyCode(feederSum, sys)} available) still leaves about ${formatMoneyCode(stillAfterFeeders, sys)} short of unpaid bills.`
    }
  } else {
    statusClass = 'account-tracker-status--warn'
    statusText = `About ${formatMoneyCode(shortBy, sys)} more is needed in this account to cover unpaid bills.`
  }

  const feederRows =
    inbound.length === 0
      ? ''
      : `
          <div class="account-tracker-row account-tracker-row--feed"><span>Available from feeder${inbound.length > 1 ? 's' : ''} (${escapeHtml(feederNames)})</span><span>${formatMoneyCode(feederSum, sys)}</span></div>${
            unpaid > 0 && balance < unpaid
              ? `
          <div class="account-tracker-row account-tracker-row--feed account-tracker-row--emph"><span>This balance + applicable feeder funds</span><span>${formatMoneyCode(effectiveTowardUnpaid, sys)}</span></div>`
              : ''
          }`

  return `
      <div class="account-tracker" data-account-tracker="${escapeAttr(acc.id)}" role="region" aria-label="Payment progress">
        <div class="account-tracker-title">On track (${escapeHtml(sys)})</div>
        <div class="account-tracker-rows">
          <div class="account-tracker-row"><span>Listed total</span><span>${formatMoneyCode(listed, sys)}</span></div>
          <div class="account-tracker-row"><span>Paid (marked)</span><span>${formatMoneyCode(paid, sys)}</span></div>
          <div class="account-tracker-row account-tracker-row--emph"><span>Still to pay</span><span>${formatMoneyCode(unpaid, sys)}</span></div>
          <div class="account-tracker-row"><span>Current balance</span><span>${formatMoneyCode(balance, sys)}</span></div>${feederRows}
        </div>
        <p class="account-tracker-status ${statusClass}">${escapeHtml(statusText)}</p>${
          feederFollowUpText
            ? `<p class="account-tracker-feeder-after">${escapeHtml(feederFollowUpText)}</p>`
            : ''
        }
        <div class="account-tracker-actions">
          <button type="button" class="link-btn" data-mark-all-paid="${escapeAttr(acc.id)}">Mark all paid</button>
          <button type="button" class="link-btn" data-clear-all-paid="${escapeAttr(acc.id)}">Clear paid marks</button>
        </div>
      </div>`
}

function displayInInputCurrency(
  storedSystemStr: string,
  inputCurrency: string,
  system: string,
  rates: UsdRates,
): string {
  const n = parseMoney(storedSystemStr)
  if (n === 0) return ''
  return roundStored(convertCross(n, system, inputCurrency, rates))
}

function lineMonthlyFromStored(amountSys: string, cadence: LevelCadence): number {
  const a = parseMoney(amountSys)
  if (a <= 0) return 0
  switch (cadence) {
    case 'once':
      return 0
    case 'week':
      return a * WEEKS_PER_MONTH
    case 'month':
      return a
    case 'year':
      return a / 12
    default:
      return 0
  }
}

function lineLumpFromStored(amountSys: string, cadence: LevelCadence): number {
  const a = parseMoney(amountSys)
  if (cadence !== 'once' || a <= 0) return 0
  return a
}

function assetLineTotals(lines: AssetCostLine[]): {
  currentMonthly: number
  targetMonthly: number
  currentLump: number
  targetLump: number
} {
  let currentMonthly = 0
  let targetMonthly = 0
  let currentLump = 0
  let targetLump = 0
  for (const ln of lines) {
    const m = lineMonthlyFromStored(ln.amount, ln.cadence)
    const lump = lineLumpFromStored(ln.amount, ln.cadence)
    if (ln.scope === 'current') {
      currentMonthly += m
      currentLump += lump
    } else {
      targetMonthly += m
      targetLump += lump
    }
  }
  return { currentMonthly, targetMonthly, currentLump, targetLump }
}

/** Recurring monthly (≈) for all "next level" lines, every account — compared to net income. */
function acquisitionTargetMonthlyAll(state: State): number {
  let sum = 0
  for (const g of state.accountAssetGoals) {
    for (const ln of g.lines) {
      if (ln.scope === 'target') sum += lineMonthlyFromStored(ln.amount, ln.cadence)
    }
  }
  return sum
}

function acquisitionTargetMonthlyForAccount(state: State, accountId: string): number {
  let sum = 0
  for (const g of state.accountAssetGoals) {
    if (g.accountId !== accountId) continue
    for (const ln of g.lines) {
      if (ln.scope === 'target') sum += lineMonthlyFromStored(ln.amount, ln.cadence)
    }
  }
  return sum
}

/** Extra monthly income needed vs this month’s net to cover all next-level recurring targets. */
function incomeGapForAcquisition(state: State): number {
  const { net } = compute(state)
  const need = acquisitionTargetMonthlyAll(state)
  return Math.max(0, need - net)
}

function monthlyToWeekly(monthly: number): number {
  return monthly <= 0 ? 0 : monthly / WEEKS_PER_MONTH
}

function monthlyToDaily(monthly: number): number {
  return monthly <= 0 ? 0 : monthly / DAYS_PER_MONTH
}

function cadenceOptionsHtml(selected: LevelCadence): string {
  const opts: { v: LevelCadence; l: string }[] = [
    { v: 'once', l: 'One-time' },
    { v: 'week', l: 'Weekly' },
    { v: 'month', l: 'Monthly' },
    { v: 'year', l: 'Yearly' },
  ]
  return opts
    .map((o) => `<option value="${o.v}"${o.v === selected ? ' selected' : ''}>${o.l}</option>`)
    .join('')
}

function scopeOptionsHtml(selected: LevelScope): string {
  const cur = selected === 'current'
  return `<option value="current"${cur ? ' selected' : ''}>Paying or saving now</option><option value="target"${!cur ? ' selected' : ''}>At next level (when you have it)</option>`
}

function assetKindOptionsHtml(selected: AssetKind): string {
  const opts: { v: AssetKind; l: string }[] = [
    { v: 'car', l: 'Car' },
    { v: 'housing', l: 'Housing' },
    { v: 'jet', l: 'Jet / aviation' },
    { v: 'other', l: 'Other' },
  ]
  return opts
    .map((o) => `<option value="${o.v}"${o.v === selected ? ' selected' : ''}>${o.l}</option>`)
    .join('')
}

function acquisitionPathOptionsHtml(selected: AcquisitionPath): string {
  const opts: { v: AcquisitionPath; l: string }[] = [
    { v: 'full', l: 'Pay in full' },
    { v: 'finance', l: 'Finance' },
    { v: 'lease', l: 'Lease' },
  ]
  return opts
    .map((o) => `<option value="${o.v}"${o.v === selected ? ' selected' : ''}>${o.l}</option>`)
    .join('')
}

function incomeThisMonth(state: State): number {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const fromPersonal = state.incomeEntries.reduce((sum, e) => {
    if (!e.earnedAt || !/^\d{4}-\d{2}-\d{2}$/.test(e.earnedAt)) return sum
    const d = new Date(e.earnedAt + 'T12:00:00')
    if (d.getFullYear() !== y || d.getMonth() !== m) return sum
    return sum + parseMoney(e.amount)
  }, 0)
  const fromBusiness = state.businessIncomeEntries.reduce((sum, e) => {
    if (!e.earnedAt || !/^\d{4}-\d{2}-\d{2}$/.test(e.earnedAt)) return sum
    const d = new Date(e.earnedAt + 'T12:00:00')
    if (d.getFullYear() !== y || d.getMonth() !== m) return sum
    return sum + parseMoney(e.amount)
  }, 0)
  return fromPersonal + fromBusiness
}

function expensesThisMonth(state: State): number {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const fromPersonal = state.expenseEntries.reduce((sum, e) => {
    if (!e.spentAt || !/^\d{4}-\d{2}-\d{2}$/.test(e.spentAt)) return sum
    const d = new Date(e.spentAt + 'T12:00:00')
    if (d.getFullYear() !== y || d.getMonth() !== m) return sum
    return sum + parseMoney(e.amount)
  }, 0)
  const fromBusiness = state.businessExpenseEntries.reduce((sum, e) => {
    if (!e.spentAt || !/^\d{4}-\d{2}-\d{2}$/.test(e.spentAt)) return sum
    const d = new Date(e.spentAt + 'T12:00:00')
    if (d.getFullYear() !== y || d.getMonth() !== m) return sum
    return sum + parseMoney(e.amount)
  }, 0)
  return fromPersonal + fromBusiness
}

function compute(state: State): {
  incomeMonthly: number
  expensesMonthly: number
  net: number
} {
  const incomeMonthly = incomeThisMonth(state)
  const expensesMonthly = expensesThisMonth(state)
  return {
    incomeMonthly,
    expensesMonthly,
    net: incomeMonthly - expensesMonthly,
  }
}

function levelLabel(net: number, incomeMonthly: number): string {
  if (incomeMonthly <= 0 && net >= 0) {
    return 'Add sources and log earnings this month to see your level.'
  }
  if (incomeMonthly <= 0) {
    return 'Log earnings with a date in this month to track your level.'
  }
  const ratio = net / incomeMonthly
  if (net >= 0 && ratio >= 0.2) {
    return 'You are in a strong position: surplus is at least 20% of income.'
  }
  if (net >= 0) {
    return 'You are balanced or slightly ahead — room to grow your cushion.'
  }
  if (net > -incomeMonthly * 0.1) {
    return 'Expenses slightly exceed income — small adjustments can flip this.'
  }
  return 'Expenses exceed income by a notable margin — worth revisiting the largest buckets.'
}

let state = loadState()

const app = document.querySelector<HTMLDivElement>('#app')!

const debouncedSave = debounce(() => saveState(state), 300)
const debouncedRemoteSave = debounce(() => {
  void saveStateRemote(state)
}, 700)

function convertAllStoredAmounts(from: string, to: string, rates: UsdRates): void {
  const c = (s: string) => {
    const n = parseMoney(s)
    if (n === 0) return ''
    return roundStored(convertCross(n, from, to, rates))
  }
  state.incomeEntries.forEach((e) => {
    e.amount = c(e.amount)
  })
  state.expenseEntries.forEach((e) => {
    e.amount = c(e.amount)
  })
  state.accountAssetGoals.forEach((g) => {
    g.lines.forEach((ln) => {
      ln.amount = c(ln.amount)
    })
  })
  state.accounts.forEach((a) => {
    a.balance = c(a.balance)
    a.debtTotal = c(a.debtTotal)
    a.debtMonthlyPayment = c(a.debtMonthlyPayment)
    a.bills.forEach((b) => {
      b.amount = c(b.amount)
    })
  })
  state.businessIncomeEntries.forEach((e) => {
    e.amount = c(e.amount)
  })
  state.businessExpenseEntries.forEach((e) => {
    e.amount = c(e.amount)
  })
}

function bindEventsOnce(): void {
  app.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const doneEl = t.closest('[data-ui-done]') as HTMLElement | null
    if (doneEl) {
      uiEdit = null
      render()
      saveState(state)
      return
    }
    const tabBtn = t.closest('[data-app-tab]') as HTMLElement | null
    if (tabBtn) {
      const v = tabBtn.getAttribute('data-app-tab')
      if (v === 'management' || v === 'money-does') {
        appTab = v
        try {
          localStorage.setItem(APP_TAB_KEY, appTab)
        } catch {
          /* ignore */
        }
        render()
      }
      return
    }
    const editEl = t.closest('[data-ui-edit]') as HTMLElement | null
    if (editEl) {
      const key = editEl.getAttribute('data-ui-edit')
      if (key) {
        uiEdit = key
        render()
      }
      return
    }
    if (t.id === 'add-money-does-card') {
      const id = uid()
      state.moneyDoesCards.push({
        id,
        title: 'New card',
        subtitle: '',
      })
      uiEdit = `money-does-card:${id}`
      render()
      saveState(state)
      return
    }
    const removeMdCard = t.closest('[data-remove-money-does-card]') as HTMLElement | null
    if (removeMdCard) {
      const cid = removeMdCard.getAttribute('data-remove-money-does-card')
      if (!cid) return
      if (uiEdit === `money-does-card:${cid}`) uiEdit = null
      state.moneyDoesCards = state.moneyDoesCards.filter((c) => c.id !== cid)
      state.expenseEntries.forEach((e) => {
        if (e.moneyDoesCardId === cid) e.moneyDoesCardId = null
      })
      state.incomeEntries.forEach((e) => {
        if (e.moneyDoesCardId === cid) e.moneyDoesCardId = null
      })
      state.accounts.forEach((acc) => {
        acc.bills.forEach((b) => {
          if (b.moneyDoesCardId === cid) b.moneyDoesCardId = null
        })
      })
      saveState(state)
      render()
      return
    }
    const untagMd = t.closest('[data-untag-money-does-entry], [data-untag-kind]') as HTMLElement | null
    if (untagMd?.getAttribute('data-untag-kind') === 'bill') {
      const aid = untagMd.getAttribute('data-untag-account-id')
      const bid = untagMd.getAttribute('data-untag-bill-id')
      if (!aid || !bid) return
      const acc = state.accounts.find((a) => a.id === aid)
      const bill = acc?.bills.find((b) => b.id === bid)
      if (bill) bill.moneyDoesCardId = null
      saveState(state)
      render()
      return
    }
    if (untagMd) {
      const eid = untagMd.getAttribute('data-untag-money-does-entry')
      const kind = untagMd.getAttribute('data-untag-kind')
      if (!eid || (kind !== 'expense' && kind !== 'income')) return
      if (kind === 'expense') {
        const entry = state.expenseEntries.find((x) => x.id === eid)
        if (entry) entry.moneyDoesCardId = null
      } else {
        const entry = state.incomeEntries.find((x) => x.id === eid)
        if (entry) entry.moneyDoesCardId = null
      }
      saveState(state)
      render()
      return
    }
    if (t.id === 'add-business') {
      const id = uid()
      state.businesses.push({ id, name: '', fedByAccountId: null, feedsAccountId: null })
      uiEdit = `business-meta:${id}`
      render()
      saveState(state)
      return
    }
    const remBiz = t.closest('[data-remove-business]') as HTMLElement | null
    if (remBiz) {
      const bid = remBiz.getAttribute('data-remove-business')
      if (!bid) return
      if (uiEdit === `business-meta:${bid}`) uiEdit = null
      state.businesses = state.businesses.filter((b) => b.id !== bid)
      state.businessIncomeEntries = state.businessIncomeEntries.filter((e) => e.businessId !== bid)
      state.businessExpenseEntries = state.businessExpenseEntries.filter((e) => e.businessId !== bid)
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    const remBizInc = t.closest('[data-remove-business-income]') as HTMLElement | null
    if (remBizInc) {
      const eid = remBizInc.getAttribute('data-remove-business-income')
      if (!eid) return
      state.businessIncomeEntries = state.businessIncomeEntries.filter((e) => e.id !== eid)
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    const remBizExp = t.closest('[data-remove-business-expense]') as HTMLElement | null
    if (remBizExp) {
      const eid = remBizExp.getAttribute('data-remove-business-expense')
      if (!eid) return
      state.businessExpenseEntries = state.businessExpenseEntries.filter((e) => e.id !== eid)
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    const bizIncAdd = t.closest('[data-biz-inc-add]') as HTMLElement | null
    if (bizIncAdd) {
      const bid = bizIncAdd.getAttribute('data-biz-inc-add')
      if (!bid || !state.businesses.some((b) => b.id === bid)) return
      const card = bizIncAdd.closest('[data-business-card]') as HTMLElement | null
      if (!card) return
      const amtEl = card.querySelector('[data-biz-inc-amt]') as HTMLInputElement | null
      const curEl = card.querySelector('[data-biz-inc-cur]') as HTMLSelectElement | null
      const dateEl = card.querySelector('[data-biz-inc-date]') as HTMLInputElement | null
      if (!amtEl || !curEl) return
      const rates = getRatesSync()
      const sysCur = state.systemCurrency
      const typed = parseMoney(amtEl.value)
      if (typed <= 0) return
      const currency = curEl.value || sysCur
      let earnedAt = (dateEl?.value || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(earnedAt)) earnedAt = new Date().toISOString().slice(0, 10)
      const amountSys = roundStored(convertCross(typed, currency, sysCur, rates))
      state.businessIncomeEntries.push({
        id: uid(),
        businessId: bid,
        amount: amountSys,
        currency,
        earnedAt,
      })
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    const bizExpAdd = t.closest('[data-biz-exp-add]') as HTMLElement | null
    if (bizExpAdd) {
      const bid = bizExpAdd.getAttribute('data-biz-exp-add')
      if (!bid || !state.businesses.some((b) => b.id === bid)) return
      const card = bizExpAdd.closest('[data-business-card]') as HTMLElement | null
      if (!card) return
      const amtEl = card.querySelector('[data-biz-exp-amt]') as HTMLInputElement | null
      const curEl = card.querySelector('[data-biz-exp-cur]') as HTMLSelectElement | null
      const dateEl = card.querySelector('[data-biz-exp-date]') as HTMLInputElement | null
      const labelEl = card.querySelector('[data-biz-exp-label]') as HTMLInputElement | null
      if (!amtEl || !curEl) return
      const rates = getRatesSync()
      const sysCur = state.systemCurrency
      const typed = parseMoney(amtEl.value)
      if (typed <= 0) return
      const currency = curEl.value || sysCur
      let spentAt = (dateEl?.value || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) spentAt = new Date().toISOString().slice(0, 10)
      const label = (labelEl?.value || '').trim()
      const amountSys = roundStored(convertCross(typed, currency, sysCur, rates))
      state.businessExpenseEntries.push({
        id: uid(),
        businessId: bid,
        amount: amountSys,
        currency,
        spentAt,
        label,
      })
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    if (t.id === 'add-income-source') {
      const id = uid()
      state.incomeSources.push({ id, name: '' })
      uiEdit = `income-source:${id}`
      render()
      saveState(state)
      return
    }
    if (t.id === 'log-income-submit') {
      const amountEl = document.getElementById('log-income-amount') as HTMLInputElement | null
      const curEl = document.getElementById('log-income-currency') as HTMLSelectElement | null
      const srcEl = document.getElementById('log-income-source') as HTMLSelectElement | null
      const accEl = document.getElementById('log-income-account') as HTMLSelectElement | null
      const dateEl = document.getElementById('log-income-date') as HTMLInputElement | null
      if (!amountEl || !curEl || !srcEl || !accEl) return
      const rates = getRatesSync()
      const sys = state.systemCurrency
      const typed = parseMoney(amountEl.value)
      if (typed <= 0) return
      const sourceId = srcEl.value
      if (!sourceId) return
      const accountId = accEl.value
      if (!accountId) return
      const currency = curEl.value || sys
      let earnedAt = (dateEl?.value || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(earnedAt)) {
        earnedAt = new Date().toISOString().slice(0, 10)
      }
      const amountSys = roundStored(convertCross(typed, currency, sys, rates))
      const mdEl = document.getElementById('log-income-money-does') as HTMLSelectElement | null
      const mdv = mdEl?.value?.trim() ?? ''
      const moneyDoesCardId =
        mdv && state.moneyDoesCards.some((c) => c.id === mdv) ? mdv : null
      state.incomeEntries.push({
        id: uid(),
        sourceId,
        amount: amountSys,
        currency,
        accountId,
        earnedAt,
        moneyDoesCardId,
      })
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    if (t.id === 'add-expense-category') {
      const id = uid()
      state.expenseCategories.push({ id, name: '' })
      uiEdit = `expense-cat:${id}`
      render()
      saveState(state)
      return
    }
    if (t.id === 'log-expense-submit') {
      const amountEl = document.getElementById('log-expense-amount') as HTMLInputElement | null
      const curEl = document.getElementById('log-expense-currency') as HTMLSelectElement | null
      const catEl = document.getElementById('log-expense-category') as HTMLSelectElement | null
      const accEl = document.getElementById('log-expense-account') as HTMLSelectElement | null
      const dateEl = document.getElementById('log-expense-date') as HTMLInputElement | null
      if (!amountEl || !curEl || !catEl || !accEl) return
      const rates = getRatesSync()
      const sys = state.systemCurrency
      const typed = parseMoney(amountEl.value)
      if (typed <= 0) return
      const categoryId = catEl.value
      if (!categoryId) return
      const accountId = accEl.value
      if (!accountId) return
      const currency = curEl.value || sys
      let spentAt = (dateEl?.value || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) {
        spentAt = new Date().toISOString().slice(0, 10)
      }
      const amountSys = roundStored(convertCross(typed, currency, sys, rates))
      const mdEl = document.getElementById('log-expense-money-does') as HTMLSelectElement | null
      const mdv = mdEl?.value?.trim() ?? ''
      const moneyDoesCardId =
        mdv && state.moneyDoesCards.some((c) => c.id === mdv) ? mdv : null
      state.expenseEntries.push({
        id: uid(),
        categoryId,
        amount: amountSys,
        currency,
        accountId,
        spentAt,
        moneyDoesCardId,
      })
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    const addAssetGoalBtn = t.closest('[data-add-asset-goal]') as HTMLElement | null
    if (addAssetGoalBtn) {
      const accId = addAssetGoalBtn.getAttribute('data-add-asset-goal')
      if (!accId) return
      const gid = uid()
      state.accountAssetGoals.push({
        id: gid,
        accountId: accId,
        assetKind: 'car',
        name: '',
        acquisitionPath: 'finance',
        lines: [],
      })
      uiEdit = `asset-goal:${gid}`
      render()
      saveState(state)
      return
    }
    const addAssetLineBtn = t.closest('[data-add-asset-line]') as HTMLElement | null
    if (addAssetLineBtn) {
      const gid = addAssetLineBtn.getAttribute('data-add-asset-line')
      if (!gid) return
      const goal = state.accountAssetGoals.find((g) => g.id === gid)
      if (!goal) return
      const lid = uid()
      goal.lines.push({
        id: lid,
        label: '',
        amount: '',
        currency: state.systemCurrency,
        cadence: 'month',
        scope: 'target',
      })
      uiEdit = `asset-line:${gid}:${lid}`
      render()
      saveState(state)
      return
    }
    const remAssetGoal = t.closest('[data-remove-asset-goal]') as HTMLElement | null
    if (remAssetGoal) {
      const gid = remAssetGoal.getAttribute('data-remove-asset-goal')
      if (!gid) return
      if (uiEdit === `asset-goal:${gid}` || uiEdit?.startsWith(`asset-line:${gid}:`)) uiEdit = null
      state.accountAssetGoals = state.accountAssetGoals.filter((g) => g.id !== gid)
      saveState(state)
      render()
      return
    }
    const remAssetLine = t.closest('[data-remove-asset-line]') as HTMLElement | null
    if (remAssetLine) {
      const lid = remAssetLine.getAttribute('data-remove-asset-line')
      if (!lid) return
      if (uiEdit?.endsWith(`:${lid}`) && uiEdit.startsWith('asset-line:')) uiEdit = null
      for (const g of state.accountAssetGoals) {
        const n = g.lines.length
        g.lines = g.lines.filter((l) => l.id !== lid)
        if (g.lines.length !== n) break
      }
      saveState(state)
      render()
      return
    }
    if (t.id === 'add-account') {
      state.accounts.push(emptyAccount(state.systemCurrency))
      render()
      saveState(state)
      return
    }
    const markAll = t.closest('[data-mark-all-paid]') as HTMLElement | null
    if (markAll) {
      const accId = markAll.getAttribute('data-mark-all-paid')
      if (!accId) return
      const acc = state.accounts.find((a) => a.id === accId)
      if (!acc) return
      acc.bills.forEach((b) => {
        if (billAmountSys(b) > 0) b.paid = true
      })
      saveState(state)
      render()
      return
    }
    const clearAll = t.closest('[data-clear-all-paid]') as HTMLElement | null
    if (clearAll) {
      const accId = clearAll.getAttribute('data-clear-all-paid')
      if (!accId) return
      const acc = state.accounts.find((a) => a.id === accId)
      if (!acc) return
      acc.bills.forEach((b) => {
        b.paid = false
      })
      saveState(state)
      render()
      return
    }
    const addBillBtn = t.closest('[data-add-bill]') as HTMLElement | null
    if (addBillBtn) {
      const accId = addBillBtn.getAttribute('data-add-bill')
      if (!accId) return
      const acc = state.accounts.find((a) => a.id === accId)
      if (!acc) return
      const bill = emptyBill(state.systemCurrency)
      acc.bills.push(bill)
      uiEdit = `bill:${accId}:${bill.id}`
      render()
      saveState(state)
      return
    }
    const removeBillBtn = t.closest('[data-remove-bill]') as HTMLElement | null
    if (removeBillBtn) {
      const accId = removeBillBtn.getAttribute('data-account-id')
      const billId = removeBillBtn.getAttribute('data-bill-id')
      if (!accId || !billId) return
      if (uiEdit === `bill:${accId}:${billId}`) uiEdit = null
      const acc = state.accounts.find((a) => a.id === accId)
      if (!acc) return
      if (acc.bills.length <= 1) {
        acc.bills = [emptyBill(state.systemCurrency)]
      } else {
        acc.bills = acc.bills.filter((b) => b.id !== billId)
      }
      render()
      saveState(state)
      return
    }
    const removeAcc = t.closest('[data-remove-account]') as HTMLElement | null
    if (removeAcc) {
      const id = removeAcc.getAttribute('data-remove-account')
      if (!id) return
      if (uiEdit === `account-meta:${id}` || uiEdit === `account-balance:${id}`) uiEdit = null
      if (state.accounts.length <= 1) {
        state.accounts = [emptyAccount(state.systemCurrency)]
        state.accountAssetGoals = []
      } else {
        state.accounts = state.accounts.filter((r) => r.id !== id)
        state.accountAssetGoals = state.accountAssetGoals.filter((g) => g.accountId !== id)
      }
      render()
      saveState(state)
      return
    }
    const removeSrc = t.closest('[data-remove-income-source]') as HTMLElement | null
    if (removeSrc) {
      const id = removeSrc.getAttribute('data-remove-income-source')
      if (!id) return
      if (uiEdit === `income-source:${id}`) uiEdit = null
      state.incomeEntries = state.incomeEntries.filter((e) => e.sourceId !== id)
      if (state.incomeSources.length <= 1) {
        state.incomeSources = [{ id: uid(), name: '' }]
      } else {
        state.incomeSources = state.incomeSources.filter((s) => s.id !== id)
      }
      render()
      saveState(state)
      return
    }
    const removeEntry = t.closest('[data-remove-income-entry]') as HTMLElement | null
    if (removeEntry) {
      const eid = removeEntry.getAttribute('data-remove-income-entry')
      if (!eid) return
      if (uiEdit === `income-entry:${eid}`) uiEdit = null
      state.incomeEntries = state.incomeEntries.filter((e) => e.id !== eid)
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    const removeExpCat = t.closest('[data-remove-expense-category]') as HTMLElement | null
    if (removeExpCat) {
      const id = removeExpCat.getAttribute('data-remove-expense-category')
      if (!id) return
      if (uiEdit === `expense-cat:${id}`) uiEdit = null
      state.expenseEntries = state.expenseEntries.filter((e) => e.categoryId !== id)
      if (state.expenseCategories.length <= 1) {
        state.expenseCategories = [{ id: uid(), name: '' }]
      } else {
        state.expenseCategories = state.expenseCategories.filter((c) => c.id !== id)
      }
      render()
      saveState(state)
      updateSummaryOnly()
      return
    }
    const removeExpEntry = t.closest('[data-remove-expense-entry]') as HTMLElement | null
    if (removeExpEntry) {
      const eid = removeExpEntry.getAttribute('data-remove-expense-entry')
      if (!eid) return
      if (uiEdit === `expense-entry:${eid}`) uiEdit = null
      state.expenseEntries = state.expenseEntries.filter((e) => e.id !== eid)
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
  })

  app.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement
    const rates = getRatesSync()
    const sys = state.systemCurrency

    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.dataset.billPaid != null) {
      const accId = el.dataset.accountId
      const billId = el.dataset.billId
      if (!accId || !billId) return
      const acc = state.accounts.find((a) => a.id === accId)
      if (!acc) return
      const bill = acc.bills.find((b) => b.id === billId)
      if (!bill) return
      bill.paid = el.checked
      saveState(state)
      render()
      return
    }

    if (el.id === 'system-currency') {
      const next = el.value
      if (next === sys) return
      convertAllStoredAmounts(sys, next, rates)
      state.systemCurrency = next
      saveState(state)
      render()
      return
    }

    if (el.dataset.balanceCurrency != null && el.dataset.id) {
      const row = state.accounts.find((r) => r.id === el.dataset.id)
      if (!row) return
      row.balanceCurrency = el.value
      saveState(state)
      render()
      return
    }

    if (el.dataset.billCurrency != null && el.dataset.billId && el.dataset.accountId) {
      const acc = state.accounts.find((a) => a.id === el.dataset.accountId)
      if (!acc) return
      const bill = acc.bills.find((b) => b.id === el.dataset.billId)
      if (!bill) return
      bill.currency = el.value
      saveState(state)
      render()
      return
    }

    if (el.dataset.accountFeeds != null && el.dataset.id) {
      const row = state.accounts.find((a) => a.id === el.dataset.id)
      if (!row) return
      const v = el.value.trim()
      row.feedsAccountId = v === '' || v === row.id ? null : v
      saveState(state)
      render()
      return
    }

    if (el.dataset.businessFedBy != null && el.dataset.id) {
      const row = state.businesses.find((b) => b.id === el.dataset.id)
      if (!row) return
      const v = el.value.trim()
      row.fedByAccountId = v === '' || !state.accounts.some((a) => a.id === v) ? null : v
      if (row.fedByAccountId && row.feedsAccountId && row.fedByAccountId === row.feedsAccountId) row.feedsAccountId = null
      saveState(state)
      render()
      return
    }
    if (el.dataset.businessFeeds != null && el.dataset.id) {
      const row = state.businesses.find((b) => b.id === el.dataset.id)
      if (!row) return
      const v = el.value.trim()
      row.feedsAccountId = v === '' || !state.accounts.some((a) => a.id === v) ? null : v
      if (row.fedByAccountId && row.feedsAccountId && row.fedByAccountId === row.feedsAccountId) row.fedByAccountId = null
      saveState(state)
      render()
      return
    }

    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.dataset.accountDebtEnabled != null && el.dataset.id) {
      const row = state.accounts.find((a) => a.id === el.dataset.id)
      if (!row) return
      row.debtSettlingEnabled = el.checked
      saveState(state)
      render()
      return
    }
    if (el.dataset.accountDebtMode != null && el.dataset.id) {
      const row = state.accounts.find((a) => a.id === el.dataset.id)
      if (!row) return
      row.debtMode = el.value === 'monthly' ? 'monthly' : 'deadline'
      saveState(state)
      render()
      return
    }
    if (el.dataset.accountDebtDeadline != null && el.dataset.id) {
      const row = state.accounts.find((a) => a.id === el.dataset.id)
      if (!row) return
      const v = el.value.trim()
      row.debtDeadline = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
      saveState(state)
      render()
      return
    }

    if (el.dataset.moneyDoesTag != null && el.dataset.entryKind) {
      const kind = el.dataset.entryKind
      const v = el.value.trim()
      const cardId =
        v && state.moneyDoesCards.some((c) => c.id === v)
          ? v
          : null
      if (kind === 'bill' && el.dataset.accountId && el.dataset.billId) {
        const acc = state.accounts.find((a) => a.id === el.dataset.accountId)
        const bill = acc?.bills.find((b) => b.id === el.dataset.billId)
        if (bill) bill.moneyDoesCardId = cardId
      } else if (kind === 'expense' && el.dataset.entryId) {
        const entry = state.expenseEntries.find((x) => x.id === el.dataset.entryId)
        if (entry) entry.moneyDoesCardId = cardId
      } else if (kind === 'income' && el.dataset.entryId) {
        const entry = state.incomeEntries.find((x) => x.id === el.dataset.entryId)
        if (entry) entry.moneyDoesCardId = cardId
      } else {
        return
      }
      saveState(state)
      render()
      return
    }

    if (el.dataset.assetKind != null && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      if (!g) return
      const v = el.value
      g.assetKind =
        v === 'car' || v === 'housing' || v === 'jet' || v === 'other' ? v : 'other'
      saveState(state)
      render()
      return
    }
    if (el.dataset.acquisitionPath != null && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      if (!g) return
      const v = el.value
      g.acquisitionPath =
        v === 'full' || v === 'finance' || v === 'lease' ? v : 'finance'
      saveState(state)
      render()
      return
    }
    if (el.dataset.assetLineCadence != null && el.dataset.lineId && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      const ln = g?.lines.find((l) => l.id === el.dataset.lineId)
      if (!ln) return
      const v = el.value
      ln.cadence =
        v === 'once' || v === 'week' || v === 'month' || v === 'year' ? v : 'month'
      saveState(state)
      render()
      return
    }
    if (el.dataset.assetLineScope != null && el.dataset.lineId && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      const ln = g?.lines.find((l) => l.id === el.dataset.lineId)
      if (!ln) return
      ln.scope = el.value === 'current' ? 'current' : 'target'
      saveState(state)
      render()
      return
    }
    if (el.dataset.assetLineCurrency != null && el.dataset.lineId && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      const ln = g?.lines.find((l) => l.id === el.dataset.lineId)
      if (!ln) return
      ln.currency = el.value
      saveState(state)
      render()
      return
    }

    if (el.dataset.incomeEntrySource != null && el.dataset.entryId) {
      const entry = state.incomeEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      entry.sourceId = el.value
      saveState(state)
      render()
      updateSummaryOnly()
      updateIncomeAcquisitionInsightOnly()
      return
    }
    if (el.dataset.incomeEntryAccount != null && el.dataset.entryId) {
      const entry = state.incomeEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      entry.accountId = el.value
      saveState(state)
      render()
      updateSummaryOnly()
      updateIncomeAcquisitionInsightOnly()
      return
    }
    if (el.dataset.incomeEntryCurrency != null && el.dataset.entryId) {
      const entry = state.incomeEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      entry.currency = el.value
      saveState(state)
      render()
      updateSummaryOnly()
      updateIncomeAcquisitionInsightOnly()
      return
    }
    if (el.dataset.expenseEntryCategory != null && el.dataset.entryId) {
      const entry = state.expenseEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      entry.categoryId = el.value
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    if (el.dataset.expenseEntryAccount != null && el.dataset.entryId) {
      const entry = state.expenseEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      entry.accountId = el.value
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
    if (el.dataset.expenseEntryCurrency != null && el.dataset.entryId) {
      const entry = state.expenseEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      entry.currency = el.value
      saveState(state)
      render()
      updateSummaryOnly()
      return
    }
  })

  app.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement
    const iid = el.dataset.id
    const bf = el.dataset.billField
    const billId = el.dataset.billId
    const accIdForBill = el.dataset.accountId
    const rates = getRatesSync()
    const sys = state.systemCurrency

    if (bf && billId && accIdForBill) {
      const acc = state.accounts.find((a) => a.id === accIdForBill)
      if (!acc) return
      const bill = acc.bills.find((b) => b.id === billId)
      if (!bill) return
      if (bf === 'label') {
        bill.label = el.value
      } else {
        const typed = parseMoney(el.value)
        bill.amount = typed === 0 ? '' : roundStored(convertCross(typed, bill.currency, sys, rates))
      }
      debouncedSave()
      patchAccountTracker(accIdForBill)
      refreshAllFeedInsights()
      return
    }
    const afid = el.dataset.accountField
    if (afid && iid) {
      const row = state.accounts.find((r) => r.id === iid)
      if (!row) return
      if (afid === 'name') row.name = el.value
      else if (afid === 'usage') row.usage = el.value
      else if (afid === 'balance') {
        const typed = parseMoney(el.value)
        row.balance = typed === 0 ? '' : roundStored(convertCross(typed, row.balanceCurrency, sys, rates))
      }
      debouncedSave()
      if (afid === 'balance') {
        patchAccountTrackerAndFeedTarget(iid)
        refreshAllFeedInsights()
      }
      return
    }
    if (el.dataset.accountDebtTotal != null && el.dataset.id) {
      const row = state.accounts.find((a) => a.id === el.dataset.id)
      if (!row) return
      const typed = parseMoney(el.value)
      row.debtTotal = typed === 0 ? '' : roundStored(typed)
      debouncedSave()
      return
    }
    if (el.dataset.accountDebtMonthly != null && el.dataset.id) {
      const row = state.accounts.find((a) => a.id === el.dataset.id)
      if (!row) return
      const typed = parseMoney(el.value)
      row.debtMonthlyPayment = typed === 0 ? '' : roundStored(typed)
      debouncedSave()
      return
    }
    if (el.dataset.moneyDoesTitle != null && el.dataset.cardId) {
      const card = state.moneyDoesCards.find((c) => c.id === el.dataset.cardId)
      if (!card) return
      card.title = el.value
      debouncedSave()
      return
    }
    if (el.dataset.moneyDoesSubtitle != null && el.dataset.cardId) {
      const card = state.moneyDoesCards.find((c) => c.id === el.dataset.cardId)
      if (!card) return
      card.subtitle = el.value
      debouncedSave()
      return
    }
    if (el.dataset.businessName != null && el.dataset.id) {
      const row = state.businesses.find((b) => b.id === el.dataset.id)
      if (!row) return
      row.name = el.value
      debouncedSave()
      return
    }
    if (el.dataset.incomeSourceName != null && el.dataset.id) {
      const row = state.incomeSources.find((r) => r.id === el.dataset.id)
      if (!row) return
      row.name = el.value
      debouncedSave()
      return
    }
    if (el.dataset.expenseCategoryName != null && el.dataset.id) {
      const row = state.expenseCategories.find((r) => r.id === el.dataset.id)
      if (!row) return
      row.name = el.value
      debouncedSave()
      return
    }
    if (el.dataset.assetGoalName != null && el.dataset.id) {
      const row = state.accountAssetGoals.find((g) => g.id === el.dataset.id)
      if (!row) return
      row.name = el.value
      debouncedSave()
      return
    }
    if (el.dataset.assetLineField === 'label' && el.dataset.lineId && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      const ln = g?.lines.find((l) => l.id === el.dataset.lineId)
      if (!ln) return
      ln.label = el.value
      debouncedSave()
      return
    }
    if (el.dataset.assetLineField === 'amount' && el.dataset.lineId && el.dataset.assetGoalId) {
      const g = state.accountAssetGoals.find((x) => x.id === el.dataset.assetGoalId)
      const ln = g?.lines.find((l) => l.id === el.dataset.lineId)
      if (!ln) return
      const typed = parseMoney(el.value)
      ln.amount = typed === 0 ? '' : roundStored(convertCross(typed, ln.currency, sys, rates))
      debouncedSave()
      updateIncomeAcquisitionInsightOnly()
      return
    }
    if (el.dataset.incomeEntryDate != null && el.dataset.entryId) {
      const entry = state.incomeEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      let v = el.value.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) v = entry.earnedAt
      entry.earnedAt = v
      debouncedSave()
      updateSummaryOnly()
      updateIncomeAcquisitionInsightOnly()
      return
    }
    if (el.dataset.incomeEntryAmount != null && el.dataset.entryId) {
      const entry = state.incomeEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      const typed = parseMoney(el.value)
      entry.amount = typed === 0 ? '' : roundStored(convertCross(typed, entry.currency, sys, rates))
      debouncedSave()
      updateSummaryOnly()
      updateIncomeAcquisitionInsightOnly()
      return
    }
    if (el.dataset.expenseEntryDate != null && el.dataset.entryId) {
      const entry = state.expenseEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      let v = el.value.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) v = entry.spentAt
      entry.spentAt = v
      debouncedSave()
      updateSummaryOnly()
      return
    }
    if (el.dataset.expenseEntryAmount != null && el.dataset.entryId) {
      const entry = state.expenseEntries.find((x) => x.id === el.dataset.entryId)
      if (!entry) return
      const typed = parseMoney(el.value)
      entry.amount = typed === 0 ? '' : roundStored(convertCross(typed, entry.currency, sys, rates))
      debouncedSave()
      updateSummaryOnly()
      return
    }
  })

  app.addEventListener(
    'blur',
    (e) => {
      const el = e.target as HTMLElement
      if (el.dataset.accountDebtTotal != null || el.dataset.accountDebtMonthly != null) {
        saveState(state)
        render()
      }
    },
    true,
  )
}

function incomeAcquisitionInsightInnerHtml(
  net: number,
  needAll: number,
  gap: number,
  sys: string,
): string {
  if (needAll <= 0) {
    return `<p class="income-acquisition-insight__p"><strong>Next level vs income.</strong> Add an acquisition target under a bank account (car, home, …) and cost lines marked <em>at next level</em>. We compare that recurring total to your net below.</p>`
  }
  if (gap <= 0) {
    return `<p class="income-acquisition-insight__p"><strong>Next level vs income.</strong> Net this month: <strong>${escapeHtml(formatMoneyCode(net, sys))}</strong>. Next-level recurring (all accounts): <strong>${escapeHtml(formatMoneyCode(needAll, sys))}</strong>/mo — at or below your net.</p>`
  }
  const gapWeek = monthlyToWeekly(gap)
  const gapDay = monthlyToDaily(gap)
  return `<p class="income-acquisition-insight__p"><strong>Next level vs income.</strong> Net: <strong>${escapeHtml(formatMoneyCode(net, sys))}</strong>. Next-level recurring total: <strong>${escapeHtml(formatMoneyCode(needAll, sys))}</strong>/mo. To sustain that pace you’d want about <strong>${escapeHtml(formatMoneyCode(gap, sys))}</strong>/mo more (≈ <strong>${escapeHtml(formatMoneyCode(gapWeek, sys))}</strong>/week, <strong>${escapeHtml(formatMoneyCode(gapDay, sys))}</strong>/day).</p>`
}

function updateIncomeAcquisitionInsightOnly(): void {
  const el = document.getElementById('income-acquisition-insight')
  if (!el) return
  const c = compute(state)
  const sys = state.systemCurrency
  const needAll = acquisitionTargetMonthlyAll(state)
  const gap = incomeGapForAcquisition(state)
  el.innerHTML = incomeAcquisitionInsightInnerHtml(c.net, needAll, gap, sys)
}

function assetKindLabel(k: AssetKind): string {
  const m: Record<AssetKind, string> = {
    car: 'Car',
    housing: 'Housing',
    jet: 'Jet / aviation',
    other: 'Other',
  }
  return m[k] ?? 'Other'
}

function acquisitionPathLabel(p: AcquisitionPath): string {
  const m: Record<AcquisitionPath, string> = {
    full: 'Pay in full',
    finance: 'Finance',
    lease: 'Lease',
  }
  return m[p] ?? p
}

function cadenceLabel(c: LevelCadence): string {
  const m: Record<LevelCadence, string> = {
    once: 'One-time',
    week: 'Weekly',
    month: 'Monthly',
    year: 'Yearly',
  }
  return m[c] ?? c
}

function scopeLabel(s: LevelScope): string {
  return s === 'current' ? 'Paying or saving now' : 'At next level'
}

function validateUiEdit(): void {
  if (!uiEdit) return
  const p = uiEdit.split(':')
  const kind = p[0]
  if (kind === 'money-does-card') {
    if (!state.moneyDoesCards.some((c) => c.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'business-meta') {
    if (!state.businesses.some((b) => b.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'income-source') {
    if (!state.incomeSources.some((s) => s.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'expense-cat') {
    if (!state.expenseCategories.some((c) => c.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'account-meta' || kind === 'account-balance') {
    if (!state.accounts.some((a) => a.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'bill') {
    const acc = state.accounts.find((a) => a.id === p[1])
    if (!acc || !acc.bills.some((b) => b.id === p[2])) uiEdit = null
    return
  }
  if (kind === 'asset-goal') {
    if (!state.accountAssetGoals.some((g) => g.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'asset-line') {
    const g = state.accountAssetGoals.find((x) => x.id === p[1])
    if (!g || !g.lines.some((l) => l.id === p[2])) uiEdit = null
    return
  }
  if (kind === 'income-entry') {
    if (!state.incomeEntries.some((e) => e.id === p[1])) uiEdit = null
    return
  }
  if (kind === 'expense-entry') {
    if (!state.expenseEntries.some((e) => e.id === p[1])) uiEdit = null
    return
  }
}

function incomeSourceRowHtml(s: IncomeSource): string {
  const key = `income-source:${s.id}`
  const editing = uiEdit === key
  const display = s.name.trim() || 'Untitled source'
  const tint = `style="${rowTintStyle(s.id)}"`
  if (editing) {
    return `<div class="entity-row entity-row--edit income-source-row entity-row--tinted" ${tint}>
      <div class="field field--grow" style="margin:0">
        <label class="entity-label">Source name</label>
        <input type="text" data-income-source-name data-id="${escapeAttr(s.id)}" placeholder="e.g. Clipping, salary" value="${escapeAttr(s.name)}" autocomplete="off" />
      </div>
      <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
    </div>`
  }
  return `<div class="entity-row entity-row--view income-source-row entity-row--tinted" ${tint}>
    <span class="entity-row__text">${escapeHtml(display)}</span>
    <div class="entity-row__actions">
      <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
      <button type="button" class="icon-btn icon-btn--danger" data-remove-income-source="${escapeAttr(s.id)}" aria-label="Delete">${ICON_X}</button>
    </div>
  </div>`
}

function expenseCategoryRowHtml(cat: ExpenseCategory): string {
  const key = `expense-cat:${cat.id}`
  const editing = uiEdit === key
  const display = cat.name.trim() || 'Untitled category'
  const tint = `style="${rowTintStyle(cat.id)}"`
  if (editing) {
    return `<div class="entity-row entity-row--edit expense-category-row entity-row--tinted" ${tint}>
      <div class="field field--grow" style="margin:0">
        <label class="entity-label">Category</label>
        <input type="text" data-expense-category-name data-id="${escapeAttr(cat.id)}" placeholder="e.g. Gas, food" value="${escapeAttr(cat.name)}" autocomplete="off" />
      </div>
      <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
    </div>`
  }
  return `<div class="entity-row entity-row--view expense-category-row entity-row--tinted" ${tint}>
    <span class="entity-row__text">${escapeHtml(display)}</span>
    <div class="entity-row__actions">
      <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
      <button type="button" class="icon-btn icon-btn--danger" data-remove-expense-category="${escapeAttr(cat.id)}" aria-label="Delete">${ICON_X}</button>
    </div>
  </div>`
}

function accountMetaHtml(row: BankAccountRow): string {
  const key = `account-meta:${row.id}`
  const editing = uiEdit === key
  const title = row.name.trim() || 'Untitled account'
  const sub = row.usage.trim() || '—'
  if (editing) {
    return `<div class="account-row account-row--edit" data-id="${escapeAttr(row.id)}">
        <div class="field" style="margin:0">
          <label>Account / bank</label>
          <input type="text" data-account-field="name" data-id="${escapeAttr(row.id)}" placeholder="e.g. Desjardins" value="${escapeAttr(row.name)}" autocomplete="off" />
        </div>
        <div class="field" style="margin:0">
          <label>Usage</label>
          <input type="text" data-account-field="usage" data-id="${escapeAttr(row.id)}" placeholder="e.g. Monthly bills" value="${escapeAttr(row.usage)}" autocomplete="off" />
        </div>
        <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
      </div>`
  }
  return `<div class="account-row account-row--view entity-row entity-row--view" data-id="${escapeAttr(row.id)}">
      <div class="account-head-display">
        <span class="account-head-display__name">${escapeHtml(title)}</span>
        <span class="account-head-display__usage">${escapeHtml(sub)}</span>
      </div>
      <div class="entity-row__actions">
        <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
        <button type="button" class="icon-btn icon-btn--danger" data-remove-account="${escapeAttr(row.id)}" aria-label="Delete account">${ICON_X}</button>
      </div>
    </div>`
}

function accountBalanceHtml(row: BankAccountRow, sys: string, rates: UsdRates): string {
  const key = `account-balance:${row.id}`
  const editing = uiEdit === key
  const bal = parseMoney(row.balance)
  const displayBal =
    bal === 0 && !row.balance
      ? '—'
      : formatMoneyCode(parseMoney(displayInInputCurrency(row.balance, row.balanceCurrency, sys, rates)), row.balanceCurrency)
  if (editing) {
    return `<div class="field money-field account-balance-field account-balance-field--edit">
        <label for="bal-${escapeAttr(row.id)}">Current balance</label>
        <div class="money-input-row">
          <input
            type="number"
            id="bal-${escapeAttr(row.id)}"
            data-account-field="balance"
            data-id="${escapeAttr(row.id)}"
            inputmode="decimal"
            step="any"
            placeholder="0"
            value="${escapeAttr(displayInInputCurrency(row.balance, row.balanceCurrency, sys, rates))}"
            autocomplete="off"
          />
          <select class="currency-select" data-balance-currency data-id="${escapeAttr(row.id)}" aria-label="Balance currency">${currencyOptionsHtml(row.balanceCurrency)}</select>
        </div>
        <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
      </div>`
  }
  return `<div class="field account-balance-field account-balance-field--view entity-row entity-row--view">
      <div class="account-balance-display">
        <span class="account-balance-display__label">Current balance</span>
        <span class="account-balance-display__value">${escapeHtml(displayBal)}</span>
      </div>
      <div class="entity-row__actions">
        <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit balance">${ICON_PEN}</button>
      </div>
    </div>`
}

function debtSettlingInsightLines(row: BankAccountRow, sys: string): string[] {
  if (!row.debtSettlingEnabled) return []
  const total = parseMoney(row.debtTotal)
  if (total <= 0) {
    return ['Enter how much debt you want to eliminate to see daily, weekly, and monthly targets.']
  }
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  if (row.debtMode === 'deadline' && row.debtDeadline && /^\d{4}-\d{2}-\d{2}$/.test(row.debtDeadline)) {
    const end = new Date(row.debtDeadline + 'T12:00:00')
    if (end.getTime() <= today.getTime()) {
      return ['Choose a future debt-free date to calculate how much to set aside per day, week, or month.']
    }
    const days = Math.max(1, Math.ceil((end.getTime() - today.getTime()) / 86400000))
    const weeks = Math.max(1, days / 7)
    const months = Math.max(1, days / 30.437)
    const perDay = total / days
    const perWeek = total / weeks
    const perMonth = total / months
    return [
      `To clear ${formatMoneyCode(total, sys)} by ${row.debtDeadline} (${days} days): about ${formatMoneyCode(perDay, sys)}/day, ${formatMoneyCode(perWeek, sys)}/week, or ${formatMoneyCode(perMonth, sys)}/month on average.`,
    ]
  }
  if (row.debtMode === 'monthly') {
    const pay = parseMoney(row.debtMonthlyPayment)
    if (pay <= 0) {
      return ['Enter how much you can put toward this debt each month to estimate the payoff horizon.']
    }
    const monthsNeeded = Math.max(1, Math.ceil(total / pay))
    const est = new Date(today)
    est.setMonth(est.getMonth() + monthsNeeded)
    const perDay = total / (monthsNeeded * 30.437)
    return [
      `At ${formatMoneyCode(pay, sys)}/month, ${formatMoneyCode(total, sys)} takes about ${monthsNeeded} month(s). Rough finish ~${est.toISOString().slice(0, 10)} (~${formatMoneyCode(perDay, sys)}/day if spread evenly).`,
    ]
  }
  return []
}

function accountDebtSettlingHtml(row: BankAccountRow, sys: string, rates: UsdRates): string {
  const lines = debtSettlingInsightLines(row, sys)
  const insight =
    lines.length > 0
      ? `<div class="debt-insight" role="status">${lines.map((l) => `<p class="debt-insight__p">${escapeHtml(l)}</p>`).join('')}</div>`
      : ''
  const totalDisp =
    row.debtTotal === ''
      ? ''
      : String(parseMoney(displayInInputCurrency(row.debtTotal, sys, sys, rates)))
  const monthlyDisp =
    row.debtMonthlyPayment === ''
      ? ''
      : String(parseMoney(displayInInputCurrency(row.debtMonthlyPayment, sys, sys, rates)))
  const bodyHidden = row.debtSettlingEnabled ? '' : ' account-debt-body--hidden'
  const dlHidden = row.debtMode !== 'deadline' ? ' hidden' : ''
  const moHidden = row.debtMode !== 'monthly' ? ' hidden' : ''
  return `<div class="account-debt-settling">
    <label class="account-debt-toggle">
      <input type="checkbox" data-account-debt-enabled data-id="${escapeAttr(row.id)}" ${row.debtSettlingEnabled ? 'checked' : ''} />
      <span>Debt-settling account</span>
    </label>
    <div class="account-debt-body${bodyHidden}">
      <p class="hint-inline account-debt-currency-note">Debt plan uses <strong>${escapeHtml(sys)}</strong> (system currency).</p>
      <div class="field money-field">
        <label>Total debt to eliminate</label>
        <input type="number" data-account-debt-total data-id="${escapeAttr(row.id)}" inputmode="decimal" min="0" step="any" placeholder="0" value="${escapeAttr(totalDisp)}" />
      </div>
      <div class="field">
        <label for="debt-mode-${escapeAttr(row.id)}">Plan</label>
        <select id="debt-mode-${escapeAttr(row.id)}" data-account-debt-mode data-id="${escapeAttr(row.id)}">
          <option value="deadline"${row.debtMode === 'deadline' ? ' selected' : ''}>By target debt-free date</option>
          <option value="monthly"${row.debtMode === 'monthly' ? ' selected' : ''}>By fixed amount per month</option>
        </select>
      </div>
      <div class="field debt-mode-field debt-mode-field--deadline"${dlHidden}>
        <label for="debt-deadline-${escapeAttr(row.id)}">Target debt-free date</label>
        <input type="date" id="debt-deadline-${escapeAttr(row.id)}" data-account-debt-deadline data-id="${escapeAttr(row.id)}" value="${row.debtDeadline ? escapeAttr(row.debtDeadline) : ''}" />
      </div>
      <div class="field money-field debt-mode-field debt-mode-field--monthly"${moHidden}>
        <label for="debt-monthly-${escapeAttr(row.id)}">Amount per month toward debt</label>
        <input type="number" id="debt-monthly-${escapeAttr(row.id)}" data-account-debt-monthly data-id="${escapeAttr(row.id)}" inputmode="decimal" min="0" step="any" placeholder="0" value="${escapeAttr(monthlyDisp)}" />
      </div>
      ${insight}
    </div>
  </div>`
}

function isIsoDateThisMonth(iso: string): boolean {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const now = new Date()
  const d = new Date(iso + 'T12:00:00')
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function moneyDoesTagSelectHtml(
  selected: string | null,
  kind: 'expense' | 'income' | 'bill',
  ids: { entryId?: string; accountId?: string; billId?: string },
): string {
  const opts = state.moneyDoesCards
    .map(
      (c) =>
        `<option value="${escapeAttr(c.id)}"${c.id === selected ? ' selected' : ''}>${escapeHtml(c.title.trim() || 'Untitled')}</option>`,
    )
    .join('')
  const attrs =
    kind === 'bill' && ids.accountId && ids.billId
      ? `class="money-does-tag-select" data-money-does-tag data-entry-kind="bill" data-account-id="${escapeAttr(ids.accountId)}" data-bill-id="${escapeAttr(ids.billId)}"`
      : `class="money-does-tag-select" data-money-does-tag data-entry-kind="${kind}" data-entry-id="${escapeAttr(ids.entryId ?? '')}"`
  return `<select ${attrs} aria-label="What the money does">
    <option value=""${!selected ? ' selected' : ''}>—</option>
    ${opts}
  </select>`
}

function moneyDoesCardTaggedLinesHtml(cardId: string, sys: string, rates: UsdRates): string {
  type Row =
    | {
        sort: string
        kind: 'expense'
        sub: string
        label: string
        amtStr: string
        entryId: string
      }
    | {
        sort: string
        kind: 'income'
        sub: string
        label: string
        amtStr: string
        entryId: string
      }
    | {
        sort: string
        kind: 'bill'
        sub: string
        label: string
        amtStr: string
        accountId: string
        billId: string
      }
  const rows: Row[] = []
  for (const e of state.expenseEntries) {
    if (e.moneyDoesCardId !== cardId || !isIsoDateThisMonth(e.spentAt)) continue
    const cat = state.expenseCategories.find((c) => c.id === e.categoryId)
    const displayAmt = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
    rows.push({
      sort: `0-${e.spentAt}-${e.id}`,
      kind: 'expense',
      sub: `${e.spentAt} · Expense`,
      label: cat?.name.trim() || 'Expense',
      amtStr: formatMoneyCode(displayAmt, e.currency),
      entryId: e.id,
    })
  }
  for (const e of state.incomeEntries) {
    if (e.moneyDoesCardId !== cardId || !isIsoDateThisMonth(e.earnedAt)) continue
    const src = state.incomeSources.find((s) => s.id === e.sourceId)
    const displayAmt = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
    rows.push({
      sort: `0-${e.earnedAt}-${e.id}`,
      kind: 'income',
      sub: `${e.earnedAt} · Income`,
      label: `${src?.name.trim() || 'Income'} (income)`,
      amtStr: formatMoneyCode(displayAmt, e.currency),
      entryId: e.id,
    })
  }
  for (const acc of state.accounts) {
    const accName = accountDisplayName(acc)
    for (const bill of acc.bills) {
      if (bill.moneyDoesCardId !== cardId) continue
      const displayAmt = parseMoney(displayInInputCurrency(bill.amount, bill.currency, sys, rates))
      rows.push({
        sort: `1-${accName}-${bill.label}-${bill.id}`,
        kind: 'bill',
        sub: `${accName} · Bill / subscription`,
        label: bill.label.trim() || 'Bill',
        amtStr: formatMoneyCode(displayAmt, bill.currency),
        accountId: acc.id,
        billId: bill.id,
      })
    }
  }
  rows.sort((a, b) => b.sort.localeCompare(a.sort))
  if (rows.length === 0) {
    return `<li class="money-does-item money-does-item--empty">
      <span class="money-does-item__empty-hint">Nothing tagged for this card — set <strong>What the money does</strong> on an income/expense line or a bill under <strong>Management → Accounts</strong>.</span>
    </li>`
  }
  return rows
    .map((r) => {
      const untagBtn =
        r.kind === 'bill'
          ? `<button type="button" class="icon-btn icon-btn--danger" data-untag-kind="bill" data-untag-account-id="${escapeAttr(r.accountId)}" data-untag-bill-id="${escapeAttr(r.billId)}" aria-label="Clear priority tag">${ICON_X}</button>`
          : `<button type="button" class="icon-btn icon-btn--danger" data-untag-money-does-entry="${escapeAttr(r.entryId)}" data-untag-kind="${r.kind}" aria-label="Clear priority tag">${ICON_X}</button>`
      return `<li class="money-does-item money-does-item--readonly">
      <div class="money-does-item__main">
        <span class="money-does-item__label">${escapeHtml(r.label)}</span>
        <span class="money-does-item__sub">${escapeHtml(r.sub)}</span>
      </div>
      <span class="money-does-item__amt">${escapeHtml(r.amtStr)}</span>
      ${untagBtn}
    </li>`
    })
    .join('')
}

function moneyDoesPieSegments(s: State): { label: string; value: number; hue: number }[] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const cardSums = new Map<string, number>()
  s.moneyDoesCards.forEach((c) => cardSums.set(c.id, 0))
  let untagged = 0
  for (const e of s.expenseEntries) {
    if (!e.spentAt || !/^\d{4}-\d{2}-\d{2}$/.test(e.spentAt)) continue
    const d = new Date(e.spentAt + 'T12:00:00')
    if (d.getFullYear() !== y || d.getMonth() !== m) continue
    const amt = parseMoney(e.amount)
    if (e.moneyDoesCardId && cardSums.has(e.moneyDoesCardId)) {
      cardSums.set(e.moneyDoesCardId, (cardSums.get(e.moneyDoesCardId) ?? 0) + amt)
    } else {
      untagged += amt
    }
  }
  const segs: { label: string; value: number; hue: number }[] = []
  for (const card of s.moneyDoesCards) {
    const v = cardSums.get(card.id) ?? 0
    if (v > 0) segs.push({ label: card.title.trim() || 'Untitled', value: v, hue: accentHueFromId(card.id) })
  }
  if (untagged > 0) segs.push({ label: 'Not tagged', value: untagged, hue: 215 })
  return segs
}

function moneyDoesPieChartHtml(sys: string): string {
  const segments = moneyDoesPieSegments(state)
  const total = segments.reduce((s, x) => s + x.value, 0)
  if (total <= 0) {
    return `<div class="money-does-pie money-does-pie--empty">
      <p class="hint-inline">No expense data for this month yet, or amounts are zero. Log spending in <strong>Management</strong> and tag rows to fill the chart.</p>
    </div>`
  }
  const cx = 100
  const cy = 100
  const rad = 88
  let angle = -Math.PI / 2
  const paths: string[] = []
  segments.forEach((seg) => {
    if (seg.value <= 0) return
    const a = (seg.value / total) * 2 * Math.PI
    const start = angle
    const end = angle + a
    const x1 = cx + rad * Math.cos(start)
    const y1 = cy + rad * Math.sin(start)
    const x2 = cx + rad * Math.cos(end)
    const y2 = cy + rad * Math.sin(end)
    const large = a > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${rad} ${rad} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`
    const fill = `hsl(${seg.hue} 42% 52%)`
    paths.push(`<path d="${d}" fill="${fill}" stroke="#fff" stroke-width="1.25" />`)
    angle = end
  })
  const legend = segments
    .filter((s) => s.value > 0)
    .map(
      (s) =>
        `<li class="money-does-pie__legend-item"><span class="money-does-pie__swatch" style="background:hsl(${s.hue} 42% 52%)"></span><span class="money-does-pie__legend-label">${escapeHtml(s.label)}</span><strong class="money-does-pie__legend-amt">${escapeHtml(formatMoneyCode(s.value, sys))}</strong></li>`,
    )
    .join('')
  return `<div class="money-does-pie">
    <svg class="money-does-pie__svg" viewBox="0 0 200 200" role="img" aria-label="This month’s spending by priority">
      ${paths.join('')}
    </svg>
    <ul class="money-does-pie__legend">${legend}</ul>
  </div>`
}

function incomeEntryMoneyDoesLedgerRowHtml(e: IncomeEntry, sys: string, rates: UsdRates): string {
  const src = state.incomeSources.find((s) => s.id === e.sourceId)
  const srcName = src?.name.trim() || 'Source'
  const acc = state.accounts.find((a) => a.id === e.accountId)
  const accName = acc ? accountDisplayName(acc) : '—'
  const displayAmt = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
  const amtStr = formatMoneyCode(displayAmt, e.currency)
  return `<tr>
      <td>${escapeHtml(e.earnedAt)}</td>
      <td>${escapeHtml(srcName)}</td>
      <td>${escapeHtml(accName)}</td>
      <td class="income-history-amt">${escapeHtml(amtStr)}</td>
      <td class="money-does-tag-cell">${moneyDoesTagSelectHtml(e.moneyDoesCardId, 'income', { entryId: e.id })}</td>
    </tr>`
}

function expenseEntryMoneyDoesLedgerRowHtml(e: ExpenseEntry, sys: string, rates: UsdRates): string {
  const cat = state.expenseCategories.find((c) => c.id === e.categoryId)
  const catName = cat?.name.trim() || 'Category'
  const acc = state.accounts.find((a) => a.id === e.accountId)
  const accName = acc ? accountDisplayName(acc) : '—'
  const displayAmt = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
  const amtStr = formatMoneyCode(displayAmt, e.currency)
  return `<tr>
      <td>${escapeHtml(e.spentAt)}</td>
      <td>${escapeHtml(catName)}</td>
      <td>${escapeHtml(accName)}</td>
      <td class="expense-history-amt">${escapeHtml(amtStr)}</td>
      <td class="money-does-tag-cell">${moneyDoesTagSelectHtml(e.moneyDoesCardId, 'expense', { entryId: e.id })}</td>
    </tr>`
}

function billMoneyDoesLedgerRowHtml(acc: BankAccountRow, bill: BillLine, sys: string, rates: UsdRates): string {
  const accName = accountDisplayName(acc)
  const displayAmt = parseMoney(displayInInputCurrency(bill.amount, bill.currency, sys, rates))
  const amtStr = formatMoneyCode(displayAmt, bill.currency)
  const paidStr = bill.paid ? 'Yes' : 'No'
  return `<tr>
      <td>${escapeHtml(accName)}</td>
      <td>${escapeHtml(bill.label.trim() || '—')}</td>
      <td class="expense-history-amt">${escapeHtml(amtStr)}</td>
      <td>${escapeHtml(paidStr)}</td>
      <td class="money-does-tag-cell">${moneyDoesTagSelectHtml(bill.moneyDoesCardId, 'bill', { accountId: acc.id, billId: bill.id })}</td>
    </tr>`
}

function moneyDoesLedgerSectionHtml(sys: string, rates: UsdRates): string {
  const incomeRows = [...state.incomeEntries]
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt) || b.id.localeCompare(a.id))
    .map((e) => incomeEntryMoneyDoesLedgerRowHtml(e, sys, rates))
    .join('')
  const expenseRows = [...state.expenseEntries]
    .sort((a, b) => b.spentAt.localeCompare(a.spentAt) || b.id.localeCompare(a.id))
    .map((e) => expenseEntryMoneyDoesLedgerRowHtml(e, sys, rates))
    .join('')
  const billFlats: { account: BankAccountRow; bill: BillLine }[] = []
  state.accounts.forEach((acc) => {
    acc.bills.forEach((bill) => billFlats.push({ account: acc, bill }))
  })
  billFlats.sort((a, b) => {
    const cmp = accountDisplayName(a.account).localeCompare(accountDisplayName(b.account))
    if (cmp !== 0) return cmp
    return (
      (a.bill.label || '').localeCompare(b.bill.label || '') || a.bill.id.localeCompare(b.bill.id)
    )
  })
  const billRows = billFlats.map(({ account, bill }) => billMoneyDoesLedgerRowHtml(account, bill, sys, rates)).join('')
  const incomeBlock =
    incomeRows.length === 0
      ? `<p class="hint-inline money-does-ledger__empty">No income entries yet — add them under <strong>Management</strong>.</p>`
      : `<div class="money-does-ledger__scroll">
      <table class="income-history-table money-does-ledger-table" aria-label="Income entries — tag priorities">
        <thead><tr><th>Date</th><th>Source</th><th>Account</th><th>Amount</th><th>What $ does</th></tr></thead>
        <tbody>${incomeRows}</tbody>
      </table></div>`
  const expenseBlock =
    expenseRows.length === 0
      ? `<p class="hint-inline money-does-ledger__empty">No expense entries yet — add them under <strong>Management</strong>.</p>`
      : `<div class="money-does-ledger__scroll">
      <table class="expense-history-table money-does-ledger-table" aria-label="Expense entries — tag priorities">
        <thead><tr><th>Date</th><th>Category</th><th>Account</th><th>Amount</th><th>What $ does</th></tr></thead>
        <tbody>${expenseRows}</tbody>
      </table></div>`
  const billsBlock =
    billRows.length === 0
      ? `<p class="hint-inline money-does-ledger__empty">No bills or subscriptions yet — add them under <strong>Management → Accounts → What is included</strong>.</p>`
      : `<div class="money-does-ledger__scroll">
      <table class="expense-history-table money-does-ledger-table money-does-ledger-table--bills" aria-label="Bills and subscriptions — tag priorities">
        <thead><tr><th>Account</th><th>Bill or subscription</th><th>Amount</th><th>Paid</th><th>What $ does</th></tr></thead>
        <tbody>${billRows}</tbody>
      </table></div>`
  return `<div class="money-does-ledger">
      <h3 class="money-does-ledger__title">Tag lines</h3>
      <p class="money-does-ledger__lead hint-inline">The same rows as <strong>Management</strong> (income, expenses, and each account’s <strong>What is included</strong> bills). Assign a priority here or there — category cards stay in sync.</p>
      <div class="money-does-ledger__block">
        <h4 class="money-does-ledger__sub">Income</h4>
        ${incomeBlock}
      </div>
      <div class="money-does-ledger__block">
        <h4 class="money-does-ledger__sub">Expenses</h4>
        ${expenseBlock}
      </div>
      <div class="money-does-ledger__block">
        <h4 class="money-does-ledger__sub">Bills &amp; subscriptions (What is included)</h4>
        ${billsBlock}
      </div>
    </div>`
}

function moneyDoesCardHtml(card: MoneyDoesCard, sys: string, rates: UsdRates): string {
  const key = `money-does-card:${card.id}`
  const editing = uiEdit === key
  const linesHtml = moneyDoesCardTaggedLinesHtml(card.id, sys, rates)
  const editBlock = `<div class="money-does-card-edit">
        <div class="field"><label>Title</label><input type="text" data-money-does-title data-card-id="${escapeAttr(card.id)}" value="${escapeAttr(card.title)}" placeholder="Card title" /></div>
        <div class="field"><label>Subtitle</label><input type="text" data-money-does-subtitle data-card-id="${escapeAttr(card.id)}" value="${escapeAttr(card.subtitle)}" placeholder="Short description" /></div>
        <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
      </div>`
  const headView = `<div class="money-does-card-head">
      <div>
        <h3 class="money-does-card-title">${escapeHtml(card.title.trim() || 'Untitled')}</h3>
        <p class="money-does-card-sub">${escapeHtml(card.subtitle)}</p>
      </div>
      <div class="money-does-card-head-actions">
        <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit card">${ICON_PEN}</button>
        <button type="button" class="icon-btn icon-btn--danger" data-remove-money-does-card="${escapeAttr(card.id)}" aria-label="Delete card">${ICON_X}</button>
      </div>
    </div>`
  return `<article class="money-does-card${editing ? ' money-does-card--editing-meta' : ''}" data-money-does-card="${escapeAttr(card.id)}" style="${accountCardAccentStyle(card.id)}">
    ${editing ? editBlock : headView}
    <ul class="money-does-items">${linesHtml}</ul>
  </article>`
}

function billRowHtml(row: BankAccountRow, bill: BillLine, sys: string, rates: UsdRates): string {
  const key = `bill:${row.id}:${bill.id}`
  const editing = uiEdit === key
  const amtStr = formatMoneyCode(
    parseMoney(displayInInputCurrency(bill.amount, bill.currency, sys, rates)),
    bill.currency,
  )
  if (editing) {
    return `
      <div class="bill-row bill-row--edit${bill.paid ? ' bill-row--paid' : ''}" data-bill-row="${escapeAttr(bill.id)}">
        <label class="bill-paid-wrap">
          <input type="checkbox" data-bill-paid data-account-id="${escapeAttr(row.id)}" data-bill-id="${escapeAttr(bill.id)}" ${bill.paid ? 'checked' : ''} title="Paid this period" />
          <span class="bill-paid-label">Paid</span>
        </label>
        <div class="field" style="margin:0">
          <label class="bill-label">Bill or subscription</label>
          <input type="text" data-bill-field="label" data-bill-id="${escapeAttr(bill.id)}" data-account-id="${escapeAttr(row.id)}" placeholder="e.g. Car insurance" value="${escapeAttr(bill.label)}" autocomplete="off" />
        </div>
        <div class="field money-field" style="margin:0">
          <label class="bill-label">Amount</label>
          <div class="money-input-row">
            <input type="number" data-bill-field="amount" data-bill-id="${escapeAttr(bill.id)}" data-account-id="${escapeAttr(row.id)}" inputmode="decimal" min="0" step="any" placeholder="0" value="${escapeAttr(displayInInputCurrency(bill.amount, bill.currency, sys, rates))}" />
            <select class="currency-select" data-bill-currency data-bill-id="${escapeAttr(bill.id)}" data-account-id="${escapeAttr(row.id)}" aria-label="Currency">${currencyOptionsHtml(bill.currency)}</select>
          </div>
        </div>
        <div class="field bill-money-does-field" style="margin:0">
          <label class="bill-label">What the money does</label>
          ${moneyDoesTagSelectHtml(bill.moneyDoesCardId, 'bill', { accountId: row.id, billId: bill.id })}
        </div>
        <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
      </div>`
  }
  return `
      <div class="bill-row bill-row--view${bill.paid ? ' bill-row--paid' : ''}" data-bill-row="${escapeAttr(bill.id)}">
        <label class="bill-paid-wrap">
          <input type="checkbox" data-bill-paid data-account-id="${escapeAttr(row.id)}" data-bill-id="${escapeAttr(bill.id)}" ${bill.paid ? 'checked' : ''} title="Paid this period" />
          <span class="bill-paid-label">Paid</span>
        </label>
        <span class="bill-view-label">${escapeHtml(bill.label || 'Untitled')}</span>
        <span class="bill-view-amt">${escapeHtml(amtStr)}</span>
        <div class="bill-row__tag">${moneyDoesTagSelectHtml(bill.moneyDoesCardId, 'bill', { accountId: row.id, billId: bill.id })}</div>
        <div class="entity-row__actions">
          <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
          <button type="button" class="icon-btn icon-btn--danger" data-remove-bill data-account-id="${escapeAttr(row.id)}" data-bill-id="${escapeAttr(bill.id)}" aria-label="Delete">${ICON_X}</button>
        </div>
      </div>`
}

function incomeEntryRowHtml(e: IncomeEntry, sys: string, rates: UsdRates): string {
  const key = `income-entry:${e.id}`
  const editing = uiEdit === key
  const src = state.incomeSources.find((s) => s.id === e.sourceId)
  const srcName = src?.name.trim() || 'Source'
  const acc = state.accounts.find((a) => a.id === e.accountId)
  const accName = acc ? accountDisplayName(acc) : '—'
  const displayAmt = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
  const amtStr = formatMoneyCode(displayAmt, e.currency)
  const sourceOpts = state.incomeSources
    .map(
      (s) =>
        `<option value="${escapeAttr(s.id)}"${s.id === e.sourceId ? ' selected' : ''}>${escapeHtml(s.name.trim() || 'Source')}</option>`,
    )
    .join('')
  const accountOpts = state.accounts
    .map(
      (a) =>
        `<option value="${escapeAttr(a.id)}"${a.id === e.accountId ? ' selected' : ''}>${escapeHtml(accountDisplayName(a))}</option>`,
    )
    .join('')
  if (editing) {
    return `<tr class="income-history-edit"><td colspan="6">
      <div class="entry-inline-edit">
        <div class="entry-inline-edit__grid">
          <div class="field"><label>Date</label><input type="date" data-income-entry-date data-entry-id="${escapeAttr(e.id)}" value="${escapeAttr(e.earnedAt)}" /></div>
          <div class="field"><label>Source</label><select data-income-entry-source data-entry-id="${escapeAttr(e.id)}">${sourceOpts}</select></div>
          <div class="field"><label>Account</label><select data-income-entry-account data-entry-id="${escapeAttr(e.id)}">${accountOpts}</select></div>
          <div class="field money-field"><label>Amount</label><div class="money-input-row">
            <input type="number" data-income-entry-amount data-entry-id="${escapeAttr(e.id)}" inputmode="decimal" min="0" step="any" value="${escapeAttr(String(displayAmt))}" />
            <select data-income-entry-currency data-entry-id="${escapeAttr(e.id)}" class="currency-select">${currencyOptionsHtml(e.currency)}</select>
          </div></div>
          <div class="field"><label>What the money does</label>${moneyDoesTagSelectHtml(e.moneyDoesCardId, 'income', { entryId: e.id })}</div>
        </div>
        <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
      </div>
    </td></tr>`
  }
  return `<tr>
      <td>${escapeHtml(e.earnedAt)}</td>
      <td>${escapeHtml(srcName)}</td>
      <td>${escapeHtml(accName)}</td>
      <td class="income-history-amt">${escapeHtml(amtStr)}</td>
      <td class="money-does-tag-cell">${moneyDoesTagSelectHtml(e.moneyDoesCardId, 'income', { entryId: e.id })}</td>
      <td class="history-row-actions">
        <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
        <button type="button" class="icon-btn icon-btn--danger" data-remove-income-entry="${escapeAttr(e.id)}" aria-label="Delete">${ICON_X}</button>
      </td>
    </tr>`
}

function expenseEntryRowHtml(e: ExpenseEntry, sys: string, rates: UsdRates): string {
  const key = `expense-entry:${e.id}`
  const editing = uiEdit === key
  const cat = state.expenseCategories.find((c) => c.id === e.categoryId)
  const catName = cat?.name.trim() || 'Category'
  const acc = state.accounts.find((a) => a.id === e.accountId)
  const accName = acc ? accountDisplayName(acc) : '—'
  const displayAmt = parseMoney(displayInInputCurrency(e.amount, e.currency, sys, rates))
  const amtStr = formatMoneyCode(displayAmt, e.currency)
  const catOpts = state.expenseCategories
    .map(
      (c) =>
        `<option value="${escapeAttr(c.id)}"${c.id === e.categoryId ? ' selected' : ''}>${escapeHtml(c.name.trim() || 'Category')}</option>`,
    )
    .join('')
  const accountOpts = state.accounts
    .map(
      (a) =>
        `<option value="${escapeAttr(a.id)}"${a.id === e.accountId ? ' selected' : ''}>${escapeHtml(accountDisplayName(a))}</option>`,
    )
    .join('')
  if (editing) {
    return `<tr class="expense-history-edit"><td colspan="6">
      <div class="entry-inline-edit">
        <div class="entry-inline-edit__grid">
          <div class="field"><label>Date</label><input type="date" data-expense-entry-date data-entry-id="${escapeAttr(e.id)}" value="${escapeAttr(e.spentAt)}" /></div>
          <div class="field"><label>Category</label><select data-expense-entry-category data-entry-id="${escapeAttr(e.id)}">${catOpts}</select></div>
          <div class="field"><label>Account</label><select data-expense-entry-account data-entry-id="${escapeAttr(e.id)}">${accountOpts}</select></div>
          <div class="field money-field"><label>Amount</label><div class="money-input-row">
            <input type="number" data-expense-entry-amount data-entry-id="${escapeAttr(e.id)}" inputmode="decimal" min="0" step="any" value="${escapeAttr(String(displayAmt))}" />
            <select data-expense-entry-currency data-entry-id="${escapeAttr(e.id)}" class="currency-select">${currencyOptionsHtml(e.currency)}</select>
          </div></div>
          <div class="field"><label>What the money does</label>${moneyDoesTagSelectHtml(e.moneyDoesCardId, 'expense', { entryId: e.id })}</div>
        </div>
        <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
      </div>
    </td></tr>`
  }
  return `<tr>
      <td>${escapeHtml(e.spentAt)}</td>
      <td>${escapeHtml(catName)}</td>
      <td>${escapeHtml(accName)}</td>
      <td class="expense-history-amt">${escapeHtml(amtStr)}</td>
      <td class="money-does-tag-cell">${moneyDoesTagSelectHtml(e.moneyDoesCardId, 'expense', { entryId: e.id })}</td>
      <td class="history-row-actions">
        <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(key)}" aria-label="Edit">${ICON_PEN}</button>
        <button type="button" class="icon-btn icon-btn--danger" data-remove-expense-entry="${escapeAttr(e.id)}" aria-label="Delete">${ICON_X}</button>
      </td>
    </tr>`
}

function accountAssetGoalsSectionHtml(row: BankAccountRow, sys: string, rates: UsdRates): string {
  const goals = state.accountAssetGoals.filter((g) => g.accountId === row.id)
  const accountNeed = acquisitionTargetMonthlyForAccount(state, row.id)
  const accountNeedWeek = monthlyToWeekly(accountNeed)
  const accountNeedDay = monthlyToDaily(accountNeed)
  const goalsHtml = goals
    .map((goal) => {
      const t = assetLineTotals(goal.lines)
      const gKey = `asset-goal:${goal.id}`
      const goalEditing = uiEdit === gKey
      const goalHead = goalEditing
        ? `<div class="account-asset-goal-head account-asset-goal-head--edit">
            <div class="field" style="margin:0">
              <label class="account-asset-label">Target</label>
              <input type="text" data-asset-goal-name data-id="${escapeAttr(goal.id)}" placeholder="e.g. Next car" value="${escapeAttr(goal.name)}" autocomplete="off" />
            </div>
            <div class="field" style="margin:0">
              <label class="account-asset-label">Asset</label>
              <select data-asset-kind data-asset-goal-id="${escapeAttr(goal.id)}" aria-label="Asset kind">${assetKindOptionsHtml(goal.assetKind)}</select>
            </div>
            <div class="field" style="margin:0">
              <label class="account-asset-label">Purchase</label>
              <select data-acquisition-path data-asset-goal-id="${escapeAttr(goal.id)}" aria-label="Full, finance, or lease">${acquisitionPathOptionsHtml(goal.acquisitionPath)}</select>
            </div>
            <button type="button" class="btn-text btn-text--done" data-ui-done>Done</button>
          </div>`
        : `<div class="account-asset-goal-head account-asset-goal-head--view entity-row entity-row--view">
            <div class="account-asset-goal__titles">
              <strong class="account-asset-goal__name">${escapeHtml(goal.name.trim() || 'Untitled target')}</strong>
              <span class="account-asset-goal__meta">${escapeHtml(assetKindLabel(goal.assetKind))} · ${escapeHtml(acquisitionPathLabel(goal.acquisitionPath))}</span>
            </div>
            <div class="entity-row__actions">
              <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(gKey)}" aria-label="Edit">${ICON_PEN}</button>
              <button type="button" class="icon-btn icon-btn--danger" data-remove-asset-goal="${escapeAttr(goal.id)}" aria-label="Delete">${ICON_X}</button>
            </div>
          </div>`
      const linesHtml = goal.lines
        .map((ln) => {
          const disp = displayInInputCurrency(ln.amount, ln.currency, sys, rates)
          const lKey = `asset-line:${goal.id}:${ln.id}`
          const lineEditing = uiEdit === lKey
          const amtStr = formatMoneyCode(parseMoney(disp), ln.currency)
          if (lineEditing) {
            return `<tr class="asset-line-tr asset-line-tr--edit">
                <td><input type="text" class="asset-line-input" data-asset-line-field="label" data-line-id="${escapeAttr(ln.id)}" data-asset-goal-id="${escapeAttr(goal.id)}" placeholder="Label" value="${escapeAttr(ln.label)}" autocomplete="off" /></td>
                <td><select data-asset-line-cadence data-line-id="${escapeAttr(ln.id)}" data-asset-goal-id="${escapeAttr(goal.id)}">${cadenceOptionsHtml(ln.cadence)}</select></td>
                <td><select data-asset-line-scope data-line-id="${escapeAttr(ln.id)}" data-asset-goal-id="${escapeAttr(goal.id)}">${scopeOptionsHtml(ln.scope)}</select></td>
                <td><input type="number" class="asset-line-input asset-line-input--num" data-asset-line-field="amount" data-line-id="${escapeAttr(ln.id)}" data-asset-goal-id="${escapeAttr(goal.id)}" inputmode="decimal" min="0" step="any" placeholder="0" value="${escapeAttr(disp)}" /></td>
                <td><select class="currency-select currency-select--compact" data-asset-line-currency data-line-id="${escapeAttr(ln.id)}" data-asset-goal-id="${escapeAttr(goal.id)}" aria-label="Currency">${currencyOptionsHtml(ln.currency)}</select></td>
                <td><button type="button" class="btn-text btn-text--done" data-ui-done>Done</button></td>
              </tr>`
          }
          return `<tr class="asset-line-tr asset-line-tr--view">
                <td><span class="asset-line-view-text">${escapeHtml(ln.label || '—')}</span></td>
                <td><span class="asset-line-view-text">${escapeHtml(cadenceLabel(ln.cadence))}</span></td>
                <td><span class="asset-line-view-text">${escapeHtml(scopeLabel(ln.scope))}</span></td>
                <td><span class="asset-line-view-text asset-line-view-amt">${escapeHtml(amtStr)}</span></td>
                <td><span class="asset-line-view-text">${escapeHtml(ln.currency)}</span></td>
                <td class="asset-line-actions">
                  <button type="button" class="icon-btn" data-ui-edit="${escapeAttr(lKey)}" aria-label="Edit">${ICON_PEN}</button>
                  <button type="button" class="icon-btn icon-btn--danger" data-remove-asset-line="${escapeAttr(ln.id)}" aria-label="Delete">${ICON_X}</button>
                </td>
              </tr>`
        })
        .join('')
      return `
        <div class="account-asset-goal" data-asset-goal-id="${escapeAttr(goal.id)}">
          ${goalHead}
          <p class="account-asset-mini">≈ Monthly: now ${escapeHtml(formatMoneyCode(t.currentMonthly, sys))} · at next level ${escapeHtml(formatMoneyCode(t.targetMonthly, sys))} · One-time: now ${escapeHtml(formatMoneyCode(t.currentLump, sys))} · next level ${escapeHtml(formatMoneyCode(t.targetLump, sys))}</p>
          <div class="asset-lines-wrap">
            <table class="asset-lines-table" aria-label="Cost lines">
              <thead><tr><th>Cost line</th><th>Cadence</th><th>When</th><th>Amount</th><th>Cur.</th><th></th></tr></thead>
              <tbody>${linesHtml}</tbody>
            </table>
            ${
              goal.lines.length === 0
                ? '<p class="asset-lines-empty hint-inline">e.g. loan payment, lease, insurance, inspection, gas or charging.</p>'
                : ''
            }
            <button type="button" class="add-btn add-btn--nested" data-add-asset-line="${escapeAttr(goal.id)}">Add cost line</button>
          </div>
        </div>`
    })
    .join('')
  return `
    <div class="account-asset-acquisition">
      <div class="account-asset-title">Next level — asset acquisition</div>
      <p class="account-asset-lead">Plan what changes when you buy: pay in full, finance, or lease, plus ongoing costs. Rows marked <strong>at next level</strong> feed the income gap below.</p>
      ${
        accountNeed > 0
          ? `<p class="account-asset-account-need">Next-level recurring for this account: <strong>${escapeHtml(formatMoneyCode(accountNeed, sys))}</strong>/mo (≈ <strong>${escapeHtml(formatMoneyCode(accountNeedWeek, sys))}</strong>/week, <strong>${escapeHtml(formatMoneyCode(accountNeedDay, sys))}</strong>/day).</p>`
          : ''
      }
      ${goalsHtml || '<p class="account-asset-empty hint-inline">No target yet — add one for this account (e.g. Desjardins for bills + future car).</p>'}
      <button type="button" class="add-btn add-btn--nested" data-add-asset-goal="${escapeAttr(row.id)}">Add acquisition target</button>
    </div>`
}

function render(): void {
  const rates = getRatesSync()
  const sys = state.systemCurrency
  const c = compute(state)
  const netClass = c.net >= 0 ? 'positive' : 'negative'
  validateUiEdit()

  const tabManagement = appTab === 'management'
  const tabMoney = appTab === 'money-does'

  app.innerHTML = `
    <nav class="app-tabs" role="tablist" aria-label="App sections">
      <button
        type="button"
        role="tab"
        id="tab-btn-management"
        class="app-tab${tabManagement ? ' app-tab--active' : ''}"
        data-app-tab="management"
        aria-selected="${tabManagement ? 'true' : 'false'}"
        aria-controls="tab-panel-management"
        tabindex="${tabManagement ? '0' : '-1'}"
      >Management</button>
      <button
        type="button"
        role="tab"
        id="tab-btn-money-does"
        class="app-tab${tabMoney ? ' app-tab--active' : ''}"
        data-app-tab="money-does"
        aria-selected="${tabMoney ? 'true' : 'false'}"
        aria-controls="tab-panel-money-does"
        tabindex="${tabMoney ? '0' : '-1'}"
      >What the money does</button>
    </nav>

    <div
      id="tab-panel-management"
      class="app-tab-panel"
      role="tabpanel"
      aria-labelledby="tab-btn-management"
      ${tabManagement ? '' : 'hidden'}
    >
    <section class="panel panel--system" aria-labelledby="currency-heading">
      <h2 id="currency-heading">System currency</h2>
      <p class="panel-lead">All totals use this currency. Amounts you enter in another currency are converted and stored here. Rates update from Frankfurter (with offline fallback).</p>
      <div class="field system-currency-row">
        <label for="system-currency">Currency for the whole app</label>
        <select id="system-currency" class="currency-select currency-select--system" aria-label="System currency">
          ${currencyOptionsHtml(sys)}
        </select>
      </div>
    </section>

    <header class="levels-header">
      <h1>Levels</h1>
      <p>Bank accounts hold bills and <strong>next-level</strong> asset plans; income and expenses show whether your cash flow can reach those targets.</p>
    </header>

    <section class="panel" aria-labelledby="accounts-heading">
      <h2 id="accounts-heading">Bank accounts <span class="tag">bills &amp; next level</span></h2>
      <div class="account-rows" id="account-rows"></div>
      <button type="button" class="add-btn" id="add-account">Add bank account</button>
    </section>

    <section class="panel" aria-labelledby="business-heading">
      <h2 id="business-heading">Business <span class="tag">ventures</span></h2>
      <p class="panel-lead hint-inline">Add a business or side project, log its income and expenses, and optionally tie it to bank accounts: <strong>Fed by</strong> (money in) and <strong>Feeds</strong> (money out). Business activity counts toward the monthly picture below.</p>
      <div class="business-rows" id="business-rows"></div>
      <button type="button" class="add-btn" id="add-business">Add business</button>
    </section>

    <section class="panel" aria-labelledby="income-heading">
      <h2 id="income-heading">Income <span class="tag">tracking</span></h2>
      <p class="panel-lead hint-inline">Name your sources (e.g. clipping), then log each payment with amount, currency, account, and date. Totals for <strong>this calendar month</strong> use <strong>${escapeHtml(sys)}</strong>.</p>
      <div id="income-panel-body"></div>
    </section>

    <section class="panel" aria-labelledby="expenses-heading">
      <h2 id="expenses-heading">Expenses <span class="tag">tracking</span></h2>
      <p class="panel-lead hint-inline">Create categories (gas, food, subscriptions, clothes, …), then log each purchase with amount, currency, account, and date to build data for budgeting.</p>
      <div id="expense-panel-body"></div>
    </section>

    <section class="summary" aria-labelledby="summary-heading">
      <h2 id="summary-heading">Monthly picture <span class="summary-cur">(${escapeHtml(sys)})</span></h2>
      <div class="summary-rows">
        <div class="summary-row">
          <span class="label">Income this month (tracked)</span>
          <span class="value">${formatMoney(c.incomeMonthly)}</span>
        </div>
        <div class="summary-row">
          <span class="label">Expenses this month (tracked)</span>
          <span class="value">${formatMoney(c.expensesMonthly)}</span>
        </div>
        <div class="summary-row net ${netClass}">
          <span class="label">Net (income − expenses)</span>
          <span class="value">${formatMoney(c.net)}</span>
        </div>
      </div>
      <div class="level-badge" role="status">
        <strong>Level note.</strong> ${escapeHtml(levelLabel(c.net, c.incomeMonthly))}
      </div>
    </section>
    </div>

    <div
      id="tab-panel-money-does"
      class="app-tab-panel app-tab-panel--money-does"
      role="tabpanel"
      aria-labelledby="tab-btn-money-does"
      ${tabMoney ? '' : 'hidden'}
    >
      <section class="panel panel--money-does" aria-labelledby="money-does-heading">
        <h2 id="money-does-heading">What the money does</h2>
        <p class="panel-lead hint-inline">Categories are the map. Log income and expenses under <strong>Management</strong>, and list bills under each account’s <strong>What is included</strong>. Tag any of those lines with <strong>What the money does</strong> here or in Management. Cards list <strong>this month’s</strong> income/expense tags plus any tagged <strong>bills</strong>; the chart still uses this month’s <strong>logged expenses</strong> only (system currency).</p>
        <div id="money-does-ledger" class="money-does-ledger-host"></div>
        <div id="money-does-pie" class="money-does-pie-host" aria-hidden="false"></div>
        <div class="money-does-grid" id="money-does-grid"></div>
        <button type="button" class="add-btn" id="add-money-does-card">Add card</button>
      </section>
    </div>
  `

  const today = new Date().toISOString().slice(0, 10)
  const incomePanelBody = document.getElementById('income-panel-body')!
  const sourcesBlock = state.incomeSources.map((s) => incomeSourceRowHtml(s)).join('')
  const sourceOpts = state.incomeSources
    .map(
      (s) =>
        `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name.trim() || 'Unnamed source')}</option>`,
    )
    .join('')
  const accountOpts = state.accounts
    .map((a) => `<option value="${escapeAttr(a.id)}">${escapeHtml(accountDisplayName(a))}</option>`)
    .join('')
  const moneyDoesLogOpts = state.moneyDoesCards
    .map(
      (c) =>
        `<option value="${escapeAttr(c.id)}">${escapeHtml(c.title.trim() || 'Untitled')}</option>`,
    )
    .join('')
  const entriesRows = [...state.incomeEntries]
    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt) || b.id.localeCompare(a.id))
    .map((e) => incomeEntryRowHtml(e, sys, rates))
    .join('')
  incomePanelBody.innerHTML = `
    <div id="income-acquisition-insight" class="income-acquisition-insight">${incomeAcquisitionInsightInnerHtml(c.net, acquisitionTargetMonthlyAll(state), incomeGapForAcquisition(state), sys)}</div>

    <div class="income-panel-grid">
      <div class="income-panel-col income-panel-col--sources">
        <h3 class="income-subhead">Sources</h3>
        <div class="income-rows income-rows--sources">${sourcesBlock}</div>
        <button type="button" class="add-btn" id="add-income-source">Add income source</button>
      </div>
      <div class="income-panel-col income-panel-col--log">
        <h3 class="income-subhead">Log earning</h3>
        <div class="income-log-form">
          <div class="field money-field">
            <label for="log-income-amount">Amount</label>
            <div class="money-input-row">
              <input type="number" id="log-income-amount" inputmode="decimal" min="0" step="any" placeholder="0" />
              <select id="log-income-currency" class="currency-select" aria-label="Currency">${currencyOptionsHtml(sys)}</select>
            </div>
          </div>
          <div class="field">
            <label for="log-income-source">Source</label>
            <select id="log-income-source">${sourceOpts}</select>
          </div>
          <div class="field">
            <label for="log-income-account">Received in account</label>
            <select id="log-income-account">${accountOpts}</select>
          </div>
          <div class="field">
            <label for="log-income-date">Date earned</label>
            <input type="date" id="log-income-date" value="${escapeAttr(today)}" />
          </div>
          <div class="field">
            <label for="log-income-money-does">What the money does</label>
            <select id="log-income-money-does" aria-label="What the money does">
              <option value="">— optional</option>
              ${moneyDoesLogOpts}
            </select>
          </div>
          <button type="button" class="add-btn" id="log-income-submit">Add earning</button>
        </div>
      </div>
    </div>

    <h3 class="income-subhead">History</h3>
    <div class="income-history-wrap">
      ${
        entriesRows.length
          ? `<table class="income-history-table" aria-label="Income entries"><thead><tr><th>Date</th><th>Source</th><th>Account</th><th>Amount</th><th>What $ does</th><th></th></tr></thead><tbody>${entriesRows}</tbody></table>`
          : `<p class="panel-lead hint-inline income-history-empty">No entries yet. Log an earning above.</p>`
      }
    </div>
  `

  const expensePanelBody = document.getElementById('expense-panel-body')!
  const expCatBlock = state.expenseCategories.map((cat) => expenseCategoryRowHtml(cat)).join('')
  const expCatOpts = state.expenseCategories
    .map(
      (cat) =>
        `<option value="${escapeAttr(cat.id)}">${escapeHtml(cat.name.trim() || 'Unnamed category')}</option>`,
    )
    .join('')
  const expAccountOpts = state.accounts
    .map((a) => `<option value="${escapeAttr(a.id)}">${escapeHtml(accountDisplayName(a))}</option>`)
    .join('')
  const expEntryRows = [...state.expenseEntries]
    .sort((a, b) => b.spentAt.localeCompare(a.spentAt) || b.id.localeCompare(a.id))
    .map((e) => expenseEntryRowHtml(e, sys, rates))
    .join('')
  expensePanelBody.innerHTML = `
    <div class="expense-panel-grid">
      <div class="expense-panel-col expense-panel-col--categories">
        <h3 class="expense-subhead">Categories</h3>
        <div class="expense-rows expense-rows--categories">${expCatBlock}</div>
        <button type="button" class="add-btn" id="add-expense-category">Add category</button>
      </div>
      <div class="expense-panel-col expense-panel-col--log">
        <h3 class="expense-subhead">Log expense</h3>
        <div class="expense-log-form">
          <div class="field money-field">
            <label for="log-expense-amount">Amount</label>
            <div class="money-input-row">
              <input type="number" id="log-expense-amount" inputmode="decimal" min="0" step="any" placeholder="0" />
              <select id="log-expense-currency" class="currency-select" aria-label="Currency">${currencyOptionsHtml(sys)}</select>
            </div>
          </div>
          <div class="field">
            <label for="log-expense-category">Category</label>
            <select id="log-expense-category">${expCatOpts}</select>
          </div>
          <div class="field">
            <label for="log-expense-account">Paid from account</label>
            <select id="log-expense-account">${expAccountOpts}</select>
          </div>
          <div class="field">
            <label for="log-expense-date">Date</label>
            <input type="date" id="log-expense-date" value="${escapeAttr(today)}" />
          </div>
          <div class="field">
            <label for="log-expense-money-does">What the money does</label>
            <select id="log-expense-money-does" aria-label="What the money does">
              <option value="">— optional</option>
              ${moneyDoesLogOpts}
            </select>
          </div>
          <button type="button" class="add-btn" id="log-expense-submit">Add expense</button>
        </div>
      </div>
    </div>

    <h3 class="expense-subhead">History</h3>
    <div class="expense-history-wrap">
      ${
        expEntryRows.length
          ? `<table class="expense-history-table" aria-label="Expense entries"><thead><tr><th>Date</th><th>Category</th><th>Account</th><th>Amount</th><th>What $ does</th><th></th></tr></thead><tbody>${expEntryRows}</tbody></table>`
          : `<p class="panel-lead hint-inline expense-history-empty">No expenses logged yet. Add one above.</p>`
      }
    </div>
  `

  const accountRows = document.getElementById('account-rows')!
  const accountGroups = groupAccountsByFeedChain(state.accounts)
  accountRows.innerHTML = accountGroups
    .map((group) => {
      const ch = clusterHue(group)
      const linked = group.length > 1
      const cards = group
        .map((row) => {
          const billsHtml = row.bills.map((bill) => billRowHtml(row, bill, sys, rates)).join('')
          return `
    <div class="account-card" data-account-card="${escapeAttr(row.id)}" style="${accountCardAccentStyle(row.id)}">
      ${accountMetaHtml(row)}
      ${accountBalanceHtml(row, sys, rates)}
      ${accountDebtSettlingHtml(row, sys, rates)}
      <div class="field feed-target-field">
        <label for="feed-${escapeAttr(row.id)}">This account feeds (optional)</label>
        <select
          id="feed-${escapeAttr(row.id)}"
          class="feed-target-select"
          data-account-feeds
          data-id="${escapeAttr(row.id)}"
          aria-label="Which account this account funds"
        >${feedsTargetOptionsHtml(row.id, row.feedsAccountId)}</select>
      </div>
      ${accountFeedInsightsHtml(row)}
      ${accountAssetGoalsSectionHtml(row, sys, rates)}
      <div class="account-bills">
        <div class="account-bills-title">What is included</div>
        <p class="account-bills-hint">Check <strong>Paid</strong> when a bill is settled. Totals use your system currency (${escapeHtml(sys)}).</p>
        <div class="bill-rows">${billsHtml}</div>
        ${accountTrackerBlock(row)}
        <button type="button" class="add-btn add-btn--nested" data-add-bill="${escapeAttr(row.id)}">Add bill or subscription</button>
      </div>
    </div>`
        })
        .join('')
      return `
    <div class="account-cluster${linked ? ' account-cluster--linked' : ''}" style="--cluster-h:${ch}" aria-label="${linked ? 'Accounts linked by feed transfers' : 'Account'}">
      ${linked ? '<div class="account-cluster-label">Linked by transfers</div>' : ''}
      ${cards}
    </div>`
    })
    .join('')

  const businessRowsEl = document.getElementById('business-rows')!
  businessRowsEl.innerHTML =
    state.businesses.length === 0
      ? '<p class="panel-lead hint-inline business-empty">No businesses yet — add one to track a venture.</p>'
      : state.businesses.map((b) => businessCardHtml(b, sys, rates, today)).join('')

  const moneyDoesLedger = document.getElementById('money-does-ledger')!
  moneyDoesLedger.innerHTML = moneyDoesLedgerSectionHtml(sys, rates)
  const moneyDoesPie = document.getElementById('money-does-pie')!
  moneyDoesPie.innerHTML = moneyDoesPieChartHtml(sys)
  const moneyDoesGrid = document.getElementById('money-does-grid')!
  moneyDoesGrid.innerHTML = state.moneyDoesCards.map((c) => moneyDoesCardHtml(c, sys, rates)).join('')
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function updateSummaryOnly(): void {
  const c = compute(state)
  const rows = app.querySelectorAll('.summary-row .value')
  if (rows.length >= 3) {
    ;(rows[0] as HTMLElement).textContent = formatMoney(c.incomeMonthly)
    ;(rows[1] as HTMLElement).textContent = formatMoney(c.expensesMonthly)
    ;(rows[2] as HTMLElement).textContent = formatMoney(c.net)
  }
  const netRow = app.querySelector('.summary-row.net')
  netRow?.classList.toggle('positive', c.net >= 0)
  netRow?.classList.toggle('negative', c.net < 0)
  const badge = app.querySelector('.level-badge')
  if (badge) {
    badge.innerHTML = `<strong>Level note.</strong> ${escapeHtml(levelLabel(c.net, c.incomeMonthly))}`
  }
  updateIncomeAcquisitionInsightOnly()
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout>
  return () => {
    clearTimeout(t)
    t = setTimeout(fn, ms)
  }
}

async function init(): Promise<void> {
  await ensureRates()
  try {
    const saved = localStorage.getItem(APP_TAB_KEY)
    if (saved === 'management' || saved === 'money-does') appTab = saved
  } catch {
    /* ignore */
  }
  bindEventsOnce()
  render()
  void hydrateStateFromRemote()
}

void init()
