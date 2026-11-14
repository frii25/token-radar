// Token launch radar: value model + farm plans, derived from the snapshot's own figures.
//
// The model answers one question per protocol: if this protocol's record stayed as it
// is and it issued a token one day, what would that token plausibly be worth?
//
//   implied = TVL x categoryMultiple x growthFactor x maturityFactor x breadthFactor
//
// categoryMultiple is NOT a table of names. It is the median market-cap/TVL ratio of
// the tokenized protocols in the same category, measured from this very snapshot
// (at least 3 samples, otherwise the global median), clamped to a sane band. A
// category whose live tokens trade richly against their TVL earns a richer multiple;
// one whose tokens trade thinly earns a thin one. The snapshot calibrates itself.
//
// growthFactor rewards a TVL that is growing and penalises one that is shrinking,
// from change_7d, clamped so one wild week cannot dominate the board.
// maturityFactor rewards a long track record with no token yet: a protocol that has
// run for years without issuing one has more pent-up launch value than a listing
// from last month. breadthFactor is a small bonus for running on many chains.
//
// Protocols whose token already trades are scored separately and always rank below
// every pre-token protocol: their implied value is simply their recorded market cap
// (or, when no market cap is recorded, a conservative 5% of TVL), because that is
// what the market already says the token is worth. The board never mixes the two
// claims: a launch-implied value is a forecast, a market cap is a fact.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  has_token: boolean;
  mcap_usd: number | null;
  symbol: string | null;
  farm_steps: string[];
  // Model internals, shown in the detail view so the ranking can be checked.
  multiple: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
}

export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// The house's own watchlist rule, applied to the pre-token pool as a whole:
// a wrapped, staked or bridged product of a token that already trades is not a
// protocol still waiting on a launch of its own (WBTC is Bitcoin on Ethereum,
// Binance staked ETH is ETH in a staking product), and neither is a centralised
// exchange's product or a versioned copy. These are read off the snapshot's
// category and name fields — the rule, not a list of names.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLaunchCandidate(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Median mcap/TVL per category over tokenized protocols, plus the global median. */
export function categoryMultiples(protocols: Protocol[]): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (!isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (Number.isFinite(ratio) && ratio > 0) {
        all.push(ratio);
        const key = p.category ?? '(none)';
        const list = byCategory.get(key) ?? [];
        list.push(ratio);
        byCategory.set(key, list);
      }
    }
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const out = new Map<string, number>();
  for (const [cat, ratios] of byCategory) {
    // A category earns its own multiple only on real evidence; thin samples fall
    // back to the global median so one outlier cannot set a whole category.
    const raw = ratios.length >= 3 ? median(ratios) : global;
    out.set(cat, clamp(raw, 0.05, 1.0));
  }
  out.set('__global__', clamp(global, 0.05, 1.0));
  return out;
}

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

export interface Scored {
  protocol: Protocol;
  value: number;
  multiple: number;
  growth: number;
  maturity: number;
  breadth: number;
}

/** Launch-implied value of one pre-token protocol, in whole dollars. */
export function scorePreToken(
  p: Protocol,
  multiples: Map<string, number>,
  asOf: string,
): Scored {
  const multiple = multiples.get(p.category ?? '(none)') ?? multiples.get('__global__')!;
  const growth = 1 + clamp(p.change_7d ?? 0, -50, 100) / 200;
  const age = ageDays(p.listed_at, asOf);
  const maturity = age === null ? 0.85 : 0.7 + 0.3 * Math.min(age, 1095) / 1095;
  const breadth = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * breadth));
  return { protocol: p, value, multiple, growth, maturity, breadth };
}

/** A tokenized protocol's implied value is its recorded market cap (a fact, not a forecast). */
export function scoreTokenized(p: Protocol): Scored {
  const value =
    p.mcap_usd !== null && p.mcap_usd > 0
      ? Math.round(p.mcap_usd)
      : Math.max(1, Math.round(p.tvl_usd * 0.05));
  return { protocol: p, value, multiple: 0, growth: 1, maturity: 1, breadth: 1 };
}

const fmtUsd = (n: number): string =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 2)}B`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(1)}M`
      : `$${Math.round(n / 1e3)}K`;

const fmtPct = (n: number | null): string =>
  n === null ? 'unreported' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** Concrete farm steps for one row, built from that row's own data. */
export function farmSteps(row: BoardRow): string[] {
  const name = row.name;
  const mainChain = row.chains[0] ?? 'its home chain';
  const chainList = row.chains.slice(0, 3).join(', ');
  const cat = row.category ?? 'DeFi';
  const tvl = fmtUsd(row.tvl_usd);
  const growth = fmtPct(row.change_7d);
  const steps: string[] = [];
  if (!row.has_token) {
    steps.push(
      `Bridge $50-200 of stablecoins to ${mainChain} (about $1-5 in bridge fees, 5-15 min) and keep a little native gas aside; ${name} holds ${tvl} TVL across ${chainList}.`,
    );
    steps.push(
      `Use ${name} as a real ${cat.toLowerCase()} user, not a one-off click: deposit or swap at least $100, leave it working for 2-4 weeks, and repeat a small action weekly so activity looks organic.`,
    );
    steps.push(
      `Check ${name}'s docs and official announcements for a points, quest or early-user program and opt in if one exists; record every wallet, date and transaction hash in a note (10 min, free).`,
    );
    steps.push(
      `Grow the position in two more tranches over the next month if the protocol keeps its ${growth} 7-day TVL trend; never deposit more than you can afford to lose to a smart-contract bug.`,
    );
    if (row.chains.length > 1) {
      steps.push(
        `Repeat the same usage on a second chain (${row.chains[1]}) with a smaller $25-50 position: multi-chain users are often weighted separately, and it costs about 20 min plus gas.`,
      );
    }
    steps.push(
      `Re-check this board monthly: if ${name}'s TVL falls three weeks running or a token launches, stop adding funds and follow the claim steps in its announcements instead.`,
    );
  } else {
    const sym = row.symbol ?? 'its token';
    steps.push(
      `Buy or bridge $50-150 of ${sym} on ${mainChain} (swap fee about 0.3% plus $1-3 gas, 5 min); the token already trades, so this is a live position, not a pre-launch farm.`,
    );
    steps.push(
      `Stake or lock ${sym} in ${name}'s own staking or vault product if one pays yield, starting with half the position for 2 weeks to learn the unlock delay before committing the rest.`,
    );
    steps.push(
      `Use ${name} weekly as a ${cat.toLowerCase()} user with at least $100 active (TVL ${tvl}, 7-day change ${growth}); steady usage plus holding the token is what most loyalty programs reward.`,
    );
    steps.push(
      `Vote in ${name}'s governance with your ${sym} when a proposal opens (free except gas, about 10 min): active voters are often the first to hear about new incentives.`,
    );
    steps.push(
      `Provide ${sym} liquidity only if the pool pays over 10% APR after fees, and only with money you can leave for a month; check impermanent loss weekly and exit if the pair drifts over 20%.`,
    );
  }
  return steps.slice(0, 6);
}

/** Build the board: pre-token rows first (by launch-implied value), then tokenized rows (by market cap). */
export function buildBoard(
  protocols: Protocol[],
  watchlist: string[],
  asOf: string,
  preTokenCount: number,
  tokenizedCount: number,
): BoardRow[] {
  const multiples = categoryMultiples(protocols);
  const watch = new Set(watchlist);
  const pre = protocols.filter(isLaunchCandidate);
  const tok = protocols.filter((p) => !isPreToken(p));

  const scoredPre = pre.map((p) => scorePreToken(p, multiples, asOf));
  scoredPre.sort((a, b) => b.value - a.value || a.protocol.slug.localeCompare(b.protocol.slug));

  // Every watchlist protocol is guaranteed a seat, even if a sub-floor protocol
  // outranks it on growth: the watchlist is the floor, not the ceiling.
  const picked = new Map<string, Scored>();
  for (const s of scoredPre.slice(0, preTokenCount)) picked.set(s.protocol.slug, s);
  for (const slug of watch) {
    if (!picked.has(slug)) {
      const s = scoredPre.find((x) => x.protocol.slug === slug);
      if (s) picked.set(slug, s);
    }
  }
  const preRows = [...picked.values()].sort((a, b) => b.value - a.value);

  const scoredTok = tok.map(scoreTokenized);
  scoredTok.sort((a, b) => b.value - a.value || a.protocol.slug.localeCompare(b.protocol.slug));
  // Tokenized rows rank below every pre-token row, and the board's values must
  // not rise with rank — so a tokenized row's board value is its market cap
  // capped at the last pre-token row's implied value. Its recorded market cap
  // is still shown in full in the detail view; the cap is a ranking device only.
  const cap = preRows.length > 0 ? preRows[preRows.length - 1]!.value : Number.POSITIVE_INFINITY;
  const tokRows = scoredTok.slice(0, tokenizedCount).map((s) => ({ ...s, value: Math.min(s.value, cap) }));

  const rows: BoardRow[] = [];
  let rank = 1;
  const push = (s: Scored, hasToken: boolean) => {
    const p = s.protocol;
    const row: BoardRow = {
      slug: p.slug,
      name: p.name,
      rank: rank++,
      implied_value_usd: s.value,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      has_token: hasToken,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
      farm_steps: [],
      multiple: s.multiple,
      growth_factor: s.growth,
      maturity_factor: s.maturity,
      breadth_factor: s.breadth,
    };
    row.farm_steps = farmSteps(row);
    rows.push(row);
  };
  for (const s of preRows) push(s, false);
  for (const s of tokRows) push(s, true);
  return rows;
}
