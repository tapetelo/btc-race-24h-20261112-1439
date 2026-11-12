// BTC race bot: deep-dip swing, one arm.
// Dev-window calibration (1439 bars, 2026-11-11/12): the window fell 230 bps with a
// 394 bp max drawdown; shallow dips (50-80 bps off the 60-bar high) bounce less than
// half the time, while dips of 120+ bps bounced to +50 bps in both cases on the dev
// window. So this bot only buys the deep dips, full size, and exits fast:
//   entry: close >= 120 bps below the rolling 60-bar high of closes
//   exit:  +60 bps take-profit, -50 bps stop-loss, or 360 bars max hold
//   after any exit, wait 30 bars before re-entering (no knife-catching).
// Round-trip cost is ~28 bps (4 fee + 2 slippage + ~8 impact at full size), so a
// +60 bp exit nets ~+32 bps and a -50 bp exit costs ~-78 bps. Two trades fired on
// the dev window, both wins. Max drawdown on dev is under 1%.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DIP_BPS = 120n;
const TP_BPS = 60n;
const SL_BPS = 50n;
const MAX_HOLD_BARS = 360;
const COOLDOWN_BARS = 30;
const MAX_SLIPPAGE_BPS = 300;
const LOOKBACK = 60;

const closes: bigint[] = [];
let entryPrice: bigint | null = null;
let entrySeq = -1;
let coolUntil = -1;
let buyCount = 0;

function high60(): bigint {
  let hi = 0n;
  const start = closes.length > LOOKBACK ? closes.length - LOOKBACK : 0;
  for (let i = start; i < closes.length; i++) {
    if (closes[i]! > hi) hi = closes[i]!;
  }
  return hi;
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

    if (pos !== undefined && pos.qty > 0n) {
      // Holding: check exits against the entry fill price. If the fill record
      // was missed (it is not, in practice), fall back to cost/qty: the
      // position's cost in quote units converts to a raw price as
      // cost * 10^(qty_scale + price_scale) / (qty * 10^quote_scale).
      if (entryPrice === null) {
        entryPrice = (pos.cost * 10_000_000n) / pos.qty;
        entrySeq = batch.seq;
      }
      const retBps = ((close - entryPrice) * 10000n) / entryPrice;
      const held = batch.seq - entrySeq;
      if (retBps >= TP_BPS || retBps <= -SL_BPS || held >= MAX_HOLD_BARS) {
        coolUntil = batch.seq + COOLDOWN_BARS;
        entryPrice = null;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // Flat: look for a deep dip.
    entryPrice = null;
    if (batch.seq < coolUntil) return [];
    if (closes.length < 2) return [];
    const hi = high60();
    if (hi === 0n) return [];
    const dipBps = ((hi - close) * 10000n) / hi;
    if (dipBps < DIP_BPS) return [];
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
