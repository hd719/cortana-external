# @cortana/market-intel

Read-only Polymarket market-intelligence layer for US equities.

It is designed as a secondary context source for Cortana/OpenClaw workflows:
- curated Polymarket market fetches
- normalization into stable TypeScript types
- quality scoring and suppression
- equity impact mapping
- support/conflict overlays versus market regime
- compact, verbose, and JSON report output

## What v1 includes

- Curated registry at [`config/market-intel/polymarket-registry.json`](/Users/hd/Developer/cortana-external/config/market-intel/polymarket-registry.json)
- File-based history under [`var/market-intel/polymarket/`](/Users/hd/Developer/cortana-external/var/market-intel/polymarket/)
- Optional regime input from the existing Python cache at `.cache/market_regime_snapshot_SPY.json`
- Seeded macro/theme models:
  - `fed_easing`
  - `recession_risk`
  - `inflation_upside`
  - `tariff_risk`
  - `geopolitical_escalation`
  - `crypto_policy_support`

## What v1 does not do

- No trading
- No wallet/authenticated Polymarket flows
- No broad platform discovery as the primary path
- No direct BUY triggers

## Package API

```ts
import {
  buildPolymarketIntelReport,
  formatCompactReport,
  formatVerboseReport,
  loadRegimeContext,
  loadRegistry,
} from "@cortana/market-intel";

const report = await buildPolymarketIntelReport({
  persistHistory: true,
});

console.log(formatCompactReport(report));
```

## Manual CLI

From [`packages/market-intel`](/Users/hd/Developer/cortana-external/packages/market-intel):

```bash
pnpm report --output compact
pnpm report --output verbose --persist
pnpm report --output json --regime /Users/hd/Developer/cortana-external/.cache/market_regime_snapshot_SPY.json
pnpm smoke
pnpm watchdog
pnpm registry-audit
```

Options:
- `--registry <path>` override registry JSON
- `--history-dir <path>` override history directory
- `--latest <path>` override latest snapshot file
- `--regime <path|json>` override regime input
- `--max-markets <n>` limit output size
- `--persist` write `latest.json` and timestamped history files

## Implementation notes

- Exact market and event slug selectors are supported, but the seeded v1 registry uses curated keyword fallback for time-sensitive contracts.
- The fetcher uses official read-only Polymarket Gamma endpoints:
  - `/markets?slug=...`
  - `/events?slug=...`
- `1h` and `24h` changes come from Polymarket fields when present.
- `4h` change is derived from local history if available.
- If Polymarket or regime data is unavailable, the package degrades safely and still returns a usable report object.

## Tests

```bash
pnpm test
```

## Production Notes

- `pnpm smoke` exits non-zero if the package cannot produce a sane report from the live feed.
- `pnpm watchdog` exits non-zero if the materialized artifacts are missing, stale, empty, or below minimum market/watchlist thresholds.
- `pnpm registry-audit` exits non-zero if required registry entries have gone dark or too many entries are running on keyword fallback only.
- The smoke command emits structured JSON logs for automation and log shipping.
- History writes are atomic to reduce the chance of corrupting `latest.json` or timestamped history snapshots during interrupted runs.
- History snapshots are pruned during integration runs to keep retention bounded.
- The test suite includes saved live-payload fixtures to catch upstream Polymarket shape drift earlier.
- Registry entries may be marked `"required": false` when they are intentionally opportunistic themes rather than critical always-on signals.
