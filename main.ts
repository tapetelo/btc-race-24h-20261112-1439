// BTC race bot v3: multi-arm FULL-BET dip-buy swing, fitted to maximise the dev window.
// Dev (offline sim, then grade-local): net PnL +$11.79, 11 trades, max DD 0.99%.
// That is ~2.1x v1 (+$5.54, 3 trades) and ~1.7x v2 (+$6.90, 3 trades).
//
// Two arms share the single position slot (never overlapping; an arm only fires
// while flat). Both buy FULL size (100% of cash) — full bet, no sizing down.
// Validated 2026-11-13 ~03:17 WIB, grade-local x2 (identical both runs):
//   net PnL +$11.784839 (+1.18%), 11 trades, win rate 66.7%, max DD 0.99%,
//   fees $4.85, 2x-fees +$6.96, guardrails met.
//   action_log_sha256 92d2a7bf6b18e3e057c0979dc432c924e841d304c48f89e9e029cdce0938f561
//   Offline sim reproduces the harness total exactly (+$11.79).
//   ARM B (deep washout, all bars): close >= 80 bps below the rolling 60-bar SMA
//     of closes. Exit TP +80 / SL -50 / max hold 120 bars. This is v2's arm with
//     TP widened 70 -> 80 (the v2 grid found TP80 best on the deep arm).
//   ARM A (range-low bounce, H1 only, bars < 720): close is a FRESH 60-bar low AND
//     >= 50 bps below the rolling 60-bar high AND the 60-bar return is >= -60 bps
//     (i.e. a range low, not a freefall low). Exit TP +100 / SL -50 / max hold 120.
//     The r60 >= -60 filter is what makes this arm work: without it, fresh-low
//     buying in the grind-down loses (v3 grid3: best -$8.20); with it, the arm
//     catches the H1 range bounces (incl. the +$10.84 DP trade at bar 46).
// No cooldown after exits (CD=0): immediate re-arm to catch consecutive bounces.
//
// Honest caveat: this bot is fitted to maximise the DEV window (the user asked for
// maximum dev PnL and accepted the dev-fit trade-off). The top-5's +$25-30 came from
// 5 H1 range bounces no rule separates cleanly from ~270 losing lows; this v3
// captures part of them (+$11.79 of the +$43.42 DP-optimal). It may NOT repeat on
// the unseen 24h race window. Round-trip cost ~28 bps (4 fee + 2 slippage + ~8
// impact at full size), so a +100 bp exit nets ~+72 bps and a -50 bp exit costs
// ~-78 bps. Guardrails: 11 trades, max DD 0.99% (< 25%).

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SMA_WINDOW = 60;
const DEEP_DIP_SMA_BPS = 80n; // arm B trigger
const TP_B_BPS = 80n;
const FRESH_LOW_DIP_HI_BPS = 50n; // arm A: dip below rolling 60-bar high
const R60_MIN_BPS = -60n; // arm A: 60-bar return floor
const TP_A_BPS = 100n;
const SL_BPS = 50n;
const MAX_HOLD_BARS = 120;
const H1_END_SEQ = 720; // arm A only on bars < 720 (where bounces live)
const MAX_SLIPPAGE_BPS = 300;

const closes: bigint[] = [];
let entryPrice: bigint | null = null;
let entrySeq = -1;
let tpBps = 0n;
let buyCount = 0;

function windowStats(): { hi: bigint; lo: bigint; sma: bigint } {
  const start = closes.length > SMA_WINDOW ? closes.length - SMA_WINDOW : 0;
  let hi = 0n;
  let lo = closes[start]!;
  let sum = 0n;
  for (let i = start; i < closes.length; i++) {
    const c = closes[i]!;
    if (c > hi) hi = c;
    if (c < lo) lo = c;
    sum += c;
  }
  return { hi, lo, sma: sum / BigInt(closes.length - start) };
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Record fills first: a filled buy sets the entry price for TP/SL.
    for (const f of batch.fills) {
      if (f.status === 'filled' && f.side === 'buy' && f.client_id.startsWith('d')) {
        entryPrice = BigInt(f.price);
        entrySeq = batch.seq;
      }
    }
    const bar = state.latest.get(SYMBOL);
    if (bar !== undefined) closes.push(BigInt(bar.c));
    if (state.warmingUp) return [];

    const pos = state.positions.get(SYMBOL);
    const close = state.close(SYMBOL);
    if (close === null) return [];
    if (closes.length < 3) return [];

    if (pos !== undefined && pos.qty > 0n) {
      // Holding: check exits against the entry fill price.
      if (entryPrice === null) {
        entryPrice = (pos.cost * 10_000_000n) / pos.qty;
        entrySeq = batch.seq;
      }
      const retBps = ((close - entryPrice) * 10000n) / entryPrice;
      const held = batch.seq - entrySeq;
      if (retBps >= tpBps || retBps <= -SL_BPS || held >= MAX_HOLD_BARS) {
        entryPrice = null;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: check arms (deep washout first, then H1 range-low).
    entryPrice = null;
    const { hi, lo, sma } = windowStats();
    if (sma === 0n || hi === 0n) return [];
    const dipSmaBps = ((sma - close) * 10000n) / sma;
    if (dipSmaBps >= DEEP_DIP_SMA_BPS) {
      tpBps = TP_B_BPS;
    } else if (batch.seq < H1_END_SEQ && close <= lo) {
      const dipHiBps = ((hi - close) * 10000n) / hi;
      if (dipHiBps < FRESH_LOW_DIP_HI_BPS) return [];
      const ref = closes.length > SMA_WINDOW ? closes[closes.length - 1 - SMA_WINDOW]! : closes[0]!;
      const r60Bps = ((close - ref) * 10000n) / ref;
      if (r60Bps < R60_MIN_BPS) return [];
      tpBps = TP_A_BPS;
    } else {
      return [];
    }
    const room = state.weightRoom(SYMBOL);
    let size = state.cash < room ? state.cash : room;
    if (size <= 0n) return [];
    buyCount++;
    const buy: BuyInput = {
      side: 'buy',
      symbol: SYMBOL,
      notional_quote_units: size,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
      client_id: `d${buyCount}`,
    };
    return [buy];
  },
});
