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
    H --> S["Nightly discovery command"]
    H --> N["Experimental alpha research (paper only)"]
    S --> T["Broader overnight universe review"]
    N --> P["Persist snapshots"]
    P --> Q["Settle forward returns"]
    Q --> R["Calibration + promotion gate"]
    I --> K["Operator reads final stock-market summary"]
    J --> K["Operator reads final stock-market summary"]
    L --> M["Operator gets fast stock or coin verdict"]
    R --> O["Operator reviews research-only alpha output"]
```

## Plain-English version

- OpenClaw or an operator starts the scheduled run.
- The `run_market_intel.sh` bridge runs the TypeScript Polymarket intelligence layer first.
- That layer fetches public Polymarket markets, keeps only high-signal macro/event context, and writes artifact files.
- The Python backtester then reads those artifacts together with its own market-regime and stock-scoring logic.
- The final thing the user sees is either a CANSLIM/Dip Buyer stock-analysis alert, a fast quick-check verdict, a broader nightly discovery review, or a separate paper-only alpha research workflow with persistence, settlement, and calibration.

## Mental model

- OpenClaw: scheduler / runner
- TypeScript layer: external macro and event intelligence
- Python layer: stock analysis and alert generation
- Nightly discovery: broader overnight candidate sweep
- Experimental alpha research: paper-only validation surface with persistence, settlement, and promotion gates
- Final output: better-informed alerts, quick checks, and research views, not automatic trades
