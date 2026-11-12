# BTC race bot v3: multi-arm full-bet dip-buy swing

Dev result (grade-local, verified by the builder 2026-11-13 ~03:17 WIB, run twice,
byte-identical): **net PnL +$11.784839 (+1.18%), 11 trades, win rate 66.7%,
max drawdown 0.99%, fees $4.85, 2x-fees +$6.96, guardrails met.**
`action_log_sha256 92d2a7bf6b18e3e057c0979dc432c924e841d304c48f89e9e029cdce0938f561`

That is ~2.1x v1 (+$5.54, 3 trades) and ~1.7x v2 (+$6.90, 3 trades) — but still
below the top-5's +$25-30 and below the +$12 minimum the parent set. It beats v1
clearly; whether it is worth swapping is the parent's call.

## Strategy

Two arms share the single position slot (max 1 open position, long only). Both
buy FULL size (100% of cash). No cooldown after exits — immediate re-arm.

- **Arm B — deep washout (all bars):** close >= 80 bps below the rolling 60-bar
  SMA of closes. Exit TP +80 / SL -50 / max hold 120 bars. (v2's arm, TP 70 -> 80.)
- **Arm A — range-low bounce (H1 only, bars < 720):** close is a fresh 60-bar low
  AND >= 50 bps below the rolling 60-bar high AND the 60-bar return >= -60 bps
  (a range low, not a freefall low). Exit TP +100 / SL -50 / max hold 120 bars.
  The r60 >= -60 filter is the key: without it fresh-low buying loses (v3 grid3
  best -$8.20); with it the arm catches the H1 range bounces, including the
  +$10.84 DP-optimal trade at bar 46.

## How it was found

Reused the v2 builder's offline simulator (reproduces the harness exactly).
Searched ~3,000+ combos across grid3 (fresh-low arm), grid4 (pullback arm),
grid5 (H1-only fresh-low + r60 floor), grid6 (micro-grid around the winner).
Dead ends: every shallow-dip / fresh-low / pullback variant without the r60
filter loses; multi-arm combinations without the filter lose; TP is a cliff.
DP-optimal on the dev window is +$43.42; the 5 biggest DP trades are H1 range
bounces (+$29.65 combined) that no tested rule separates cleanly from ~270
losing lows — v3 captures part of them.

## Honest caveat

This bot is fitted to maximise the DEV window, at the user's explicit request
("multi arm full bet, cari pnl setinggi-tingginya"); robustness is secondary.
It may NOT repeat on the unseen 24h race window. Do not present the dev PnL
as expected race profit.

## Files

- `main.ts` — the bot (Node 22, stdlib only, deterministic, no network)
- `vendor/makefun-bars.ts` — kit shim, byte-identical to the v1 entry's
- `.makefun/owner.json` — `{"wallet": "2QBDo7UWyz4UUzSuEmuo2JbFTSHxVajpCj5Wjz34fY9u"}`
