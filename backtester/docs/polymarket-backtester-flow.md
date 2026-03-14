# Polymarket + Backtester Flow

This is the simplest user-facing view of how the stock-analysis flow works.

```mermaid
flowchart LR
    A["OpenClaw cron or operator run"] --> B["run_market_intel.sh"]
    B --> C["TypeScript market-intel package"]
    C --> D["Fetch Polymarket public markets"]
    C --> E["Score and filter macro/event signals"]
    E --> F["Write compact report + watchlist artifacts"]
    F --> G["Python backtester"]
    G --> H["Market regime + stock scoring"]
    H --> I["CANSLIM alert"]
    H --> J["Dip Buyer alert"]
    H --> L["Quick check command"]
    I --> K["Operator reads final stock-market summary"]
    J --> K["Operator reads final stock-market summary"]
    L --> M["Operator gets fast stock or coin verdict"]
```

## Plain-English version

- OpenClaw or an operator starts the scheduled run.
- The `run_market_intel.sh` bridge runs the TypeScript Polymarket intelligence layer first.
- That layer fetches public Polymarket markets, keeps only high-signal macro/event context, and writes artifact files.
- The Python backtester then reads those artifacts together with its own market-regime and stock-scoring logic.
- The final thing the user sees is either a CANSLIM/Dip Buyer stock-analysis alert or a fast quick-check verdict, both with better macro context.

## Mental model

- OpenClaw: scheduler / runner
- TypeScript layer: external macro and event intelligence
- Python layer: stock analysis and alert generation
- Final output: better-informed alerts and quick checks, not automatic trades
