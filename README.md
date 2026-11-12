# BTC race bot: deep-dip swing

One-arm dip-buy swing bot for the make.fun BTC race (CBBTC/USDC, 1-minute bars).

## Strategy

Calibrated on the dev window (1,439 bars, 2026-11-11/12, BTC fell 230 bps with a
394 bp max drawdown). Shallow dips (50-80 bps off the 60-bar high) bounce less
than half the time on this window, so the bot only buys the deep dips:

- **Entry:** close >= 120 bps below the rolling 60-bar high of closes. Full size
  (100% of equity, capped by the harness weight cap).
- **Exit:** +60 bps take-profit, -50 bps stop-loss (both vs the entry fill price),
  or 360 bars max hold.
- **Cooldown:** 30 bars after any exit, so it never re-buys straight into a
  falling knife.
- **Costs:** a full-size round trip pays ~28 bps (4 fee + 2 slippage + ~8 impact),
  so a +60 bp exit nets ~+32 bps and a -50 bp exit costs ~-78 bps.

## Dev result (grade-local, --driver process)

- Net PnL **+$5.54** (return +0.55%), 3 trades, win rate 100%, max drawdown 0.31%
- Fees $1.61; at 2x fees net PnL +$3.93. Guardrails met.
- Deterministic: two runs give the same action_log_sha256.

## Run locally

```
cd <kit dir>
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```
