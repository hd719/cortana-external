import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradingOpsDashboard } from "@/components/trading-ops-dashboard";
import type { TradingOpsDashboardData } from "@/lib/trading-ops";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: MessageEvent) => void) {
    const existing = this.listeners.get(event) ?? new Set<(event: MessageEvent) => void>();
    existing.add(handler);
    this.listeners.set(event, existing);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const payload = { data: JSON.stringify(data) } as MessageEvent;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  fail() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

const financialServicesFixture: TradingOpsDashboardData["financialServices"] = {
  state: "ok",
  label: "Financial services health",
  message: "5 services healthy.",
  updatedAt: "2026-04-03T23:28:00.000Z",
  source: "http://127.0.0.1:3033/market-data/ops · http://127.0.0.1:3033/polymarket/health · http://127.0.0.1:3033/polymarket/live",
  warnings: [],
  badgeText: "5/5",
  data: {
    rows: [
      {
        label: "CoinMarketCap",
        state: "ok",
        summary: "configured",
        detail: "Market-data ops sees CoinMarketCap configured for crypto coverage.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "configured",
      },
      {
        label: "Schwab REST",
        state: "ok",
        summary: "healthy",
        detail: "Last successful REST quote at Apr 3, 7:27 PM.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "rest",
      },
      {
        label: "Schwab streamer",
        state: "ok",
        summary: "connected",
        detail: "55 equity subs · 0 acct activity.",
        source: "/market-data/ops",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "stream",
      },
      {
        label: "Polymarket REST",
        state: "ok",
        summary: "healthy",
        detail: "API https://api.polymarket.us is reachable.",
        source: "/polymarket/health",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "rest",
      },
      {
        label: "Polymarket streamer",
        state: "ok",
        summary: "connected",
        detail: "106 tracked markets · last market msg Apr 3, 7:27 PM.",
        source: "/polymarket/live",
        updatedAt: "2026-04-03T23:28:00.000Z",
        badgeText: "stream",
      },
    ],
    healthyCount: 5,
    degradedCount: 0,
    errorCount: 0,
    checkedAt: "2026-04-03T23:28:00.000Z",
  },
};

const fixture: TradingOpsDashboardData = {
  generatedAt: "2026-04-03T23:30:00.000Z",
  repoPath: "/Users/hd/Developer/cortana-external/backtester",
  cortanaRepoPath: "/Users/hd/Developer/cortana",
  market: {
    state: "degraded",
    label: "CORRECTION",
    message: "Stay defensive until fresher data is available.",
    updatedAt: "2026-04-03T23:15:25.794002+00:00",
    source: "/tmp/canslim-alert.json",
    warnings: ["cached history"],
    data: {
      posture: "Stand aside",
      reason: "Stay defensive until fresher data is available.",
      regime: "correction",
      regimeStatus: "degraded",
      positionSizingPct: 0,
      focusSymbols: ["OXY", "GEV", "FANG"],
      leaderSource: "leader baskets",
      alertSummary: "Summary: scanned 120 | BUY 0 | WATCH 0 | NO_BUY 0",
      nextAction: "Retry after cooldown",
      isStale: false,
      referenceRunLabel: null,
      referenceDecision: null,
    },
  },
  runtime: {
    state: "degraded",
    label: "provider_cooldown",
    message: "Wait for cooldown to clear.",
    updatedAt: "2026-04-03T23:25:53.853293+00:00",
    source: "/tmp/runtime_health_snapshot.py",
    warnings: ["provider_cooldown:medium"],
    data: {
      operatorState: "provider_cooldown",
      operatorAction: "Wait for cooldown to clear.",
      preOpenGateStatus: "Warn",
      preOpenGateDetail: null,
      preOpenGateFreshness: "Last pre-open readiness check ran 10m ago at Apr 3, 7:15 PM ET.",
      cooldownSummary: "Cooldown is active now. Watchdog still sees provider health, quote smoke failing since Apr 3, 7:02 PM ET.",
      providerModeSummary: "Live quotes: schwab_primary.",
      incidents: [{ incidentType: "provider_cooldown", severity: "medium", operatorAction: "Wait." }],
    },
  },
  canary: {
    state: "degraded",
    label: "warn",
    message: "1 checks need attention.",
    updatedAt: "2026-04-03T23:15:22.659140+00:00",
    source: "/tmp/pre-open-canary-latest.json",
    warnings: ["service_ready:provider_cooldown"],
    data: {
      readyForOpen: false,
      result: "warn",
      warningCount: 1,
      checkedAt: "2026-04-03T23:15:22.659140+00:00",
      freshness: "Apr 3, 7:15 PM (15m ago)",
      checks: [{ name: "service_ready", result: "warn" }],
    },
  },
  operatorVerdict: {
    state: "degraded",
    label: "Research only",
    message: "BUY and WATCH are not proven yet.",
    updatedAt: "2026-04-03T23:16:04.700000+00:00",
    source: "/tmp/decision-review-latest.json",
    warnings: ["BUY is still losing on average."],
    badgeText: "blocked",
    data: {
      verdictLabel: "Do not size up",
      cautionLabel: "Research-only signal",
      oneDayMatured: 880,
      fiveDayMatured: 7,
      buySamples: 72,
      buyAvgReturnPct: -0.73,
      buyHitRate: 0.361,
      watchSamples: 196,
      watchAvgReturnPct: -1.06,
      watchHitRate: 0.362,
      noBuySamples: 673,
      noBuyAvoidanceRate: 0.548,
      highConfidenceBuySamples: 18,
      highConfidenceBuyAvgReturnPct: -1.18,
      highConfidenceBuyHitRate: 0,
      overblockRate: 0,
      topBlocker: "market_regime",
      actionItems: [
        "Treat BUY and WATCH as research-only until the 5d horizon has real sample depth.",
        "Block discretionary execution whenever the live BUY lane is stale or degraded.",
      ],
    },
  },
  prediction: {
    state: "ok",
    label: "Prediction loop",
    message: "449 snapshots, 1838 settled records tracked.",
    updatedAt: "2026-04-03T23:16:04.659512+00:00",
    source: "/tmp/prediction-accuracy-latest.json",
    warnings: [],
    data: {
      snapshotCount: 449,
      recordCount: 1838,
      oneDayMatured: 880,
      oneDayPending: 337,
      bestStrategyLabel: "dip_buyer WATCH",
      decisionGradeHeadline: "good:10 · mixed:5",
      trustState: "degraded",
      freshnessLabel: "degraded",
      topStrategyFamily: "dip_buyer",
      shadowAgreementLabel: "dip_buyer 81%",
    },
  },
  benchmark: {
    state: "ok",
    label: "Benchmark comparisons",
    message: "Primary horizon 5d.",
    updatedAt: "2026-04-03T23:16:04.695355+00:00",
    source: "/tmp/benchmark-comparison-latest.json",
    warnings: [],
    data: {
      horizonKey: "5d",
      maturedCount: 7,
      bestComparisonLabel: "canslim vs baseline",
    },
  },
  lifecycle: {
    state: "ok",
    label: "Trade lifecycle",
    message: "1 open, 2 closed.",
    updatedAt: "2026-04-03T22:20:35.951192+00:00",
    source: "/tmp/cycle_summary.json",
    warnings: [],
    data: {
      openCount: 1,
      closedCount: 2,
      totalCapital: 100000,
      availableCapital: 85000,
      grossExposurePct: 15,
      postureState: "selective",
      autonomyMode: "supervised_live",
      authoritySummary: "trusted · supervised_live",
      familyBudgetHeadline: "dip_buyer $25,000",
      warningCount: 1,
      blockerCount: 0,
    },
  },
  controlTower: {
    state: "degraded",
    label: "Control tower",
    message: "Observed drift requires a temporary authority reduction. 2 proposed reconciliation actions pending. 1 active intervention visible.",
    updatedAt: "2026-04-03T22:20:35.951192+00:00",
    source: "/tmp/desired_state.json · /tmp/actual_state.json",
    warnings: ["drift:degraded", "pending-actions:2", "active-interventions:1"],
    badgeText: "degraded",
    data: {
      desiredPosture: "selective",
      actualPosture: "paused",
      desiredAutonomy: "supervised_live",
      actualAutonomy: "advisory",
      stateAlignment: "drifted",
      releaseKey: "bt-v4-control-loop",
      releaseMode: "steady",
      releaseStatus: "ok",
      releaseValidation: "valid",
      rollbackReady: true,
      driftStatus: "degraded",
      driftSummary: "Observed drift requires a temporary authority reduction.",
      pendingActionCount: 2,
      appliedActionCount: 1,
      activeInterventionCount: 1,
      interventionTypes: ["manual_pause"],
      topAction: "rebalance_posture",
      topActionStatus: "proposed",
      buyReadinessDecision: "BUY_BLOCKED",
      buyReadinessBlockers: ["manual_pause"],
      operatorAction: "Resolve visible interventions before restoring authority. Review the pending reconciliation actions before widening posture.",
      scheduleRows: [
        {
          name: "Lifecycle cycle",
          lastRunAt: "2026-04-03T22:20:35.951192+00:00",
          nextExpectedAt: "2026-04-04T02:20:35.951Z",
          freshnessLabel: "2h ago",
          state: "ok",
          source: "/tmp/cycle_summary.json",
        },
      ],
      lateScheduleCount: 0,
    },
  },
  workflow: {
    state: "degraded",
    label: "20260403-231522",
    message: "Failed stages: dipbuyer_alert",
    updatedAt: "2026-04-03T23:16:03Z",
    source: "/tmp/local-workflows/20260403-231522",
    warnings: ["dipbuyer_alert"],
    data: {
      runId: "20260403-231522",
      runLabel: "Apr 3, 7:16 PM",
      stageCounts: { ok: 2, error: 1 },
      failedStages: ["dipbuyer_alert"],
      stageRows: [
        { name: "market_regime", status: "ok", startedAt: "2026-04-03T23:15:22Z", endedAt: "2026-04-03T23:15:25Z" },
        { name: "dipbuyer_alert", status: "error", startedAt: "2026-04-03T23:15:29Z", endedAt: "2026-04-03T23:16:03Z" },
      ],
      artifactRows: [{ name: "canslim-alert-json", kind: "strategy_alert", location: "/tmp/canslim-alert.json" }],
      canslimSummary: "Summary: scanned 120 | BUY 0 | WATCH 0 | NO_BUY 0",
      isStale: false,
      referenceRunLabel: null,
    },
  },
  opsHighway: {
    state: "ok",
    label: "Ops highway",
    message: "2 critical assets tracked for recovery.",
    updatedAt: "2026-04-03T23:26:00.000000+00:00",
    source: "/tmp/ops_highway_snapshot.py",
    warnings: [],
    data: {
      criticalAssetCount: 2,
      doNotCommitCount: 1,
      firstRecoveryStep: "Restore repo config.",
    },
  },
  financialServices: financialServicesFixture,
  alertDelivery: {
    state: "ok",
    label: "Alert delivery",
    message: "Latest alert delivered.",
    updatedAt: "2026-04-03T23:27:00.000Z",
    source: "/tmp/alert-delivery.jsonl",
    warnings: [],
    data: {
      sentCount: 1,
      failedCount: 0,
      lastSentAt: "2026-04-03T23:27:00.000Z",
      lastStatus: "sent",
      lastChannel: "telegram",
      lastDedupeKey: "trading_advisor:20260403-163103",
      rows: [],
    },
  },
  scheduleRegistry: {
    state: "ok",
    label: "Schedule registry",
    message: "4 schedules registered.",
    updatedAt: "2026-04-03T23:27:00.000Z",
    source: "/tmp/schedule-registry.json",
    warnings: [],
    data: {
      scheduleCount: 4,
      launchdCount: 1,
      artifactCount: 2,
      cronRegistryCount: 1,
      rows: [],
    },
  },
  tradingRun: {
    state: "ok",
    label: "20260403-163103",
    message: "Latest trading run finished with WATCH and 36 watch names.",
    updatedAt: "2026-04-03T16:38:59.979Z",
    source: "/Users/hd/Developer/cortana/var/backtests/runs/20260403-163103",
    warnings: [],
    data: {
      runId: "20260403-163103",
      runLabel: "Apr 3, 12:38 PM",
      status: "success",
      deliveryStatus: "notified",
      decision: "WATCH",
      focusTicker: "ABBV",
      focusAction: "WATCH",
      focusStrategy: "Dip Buyer",
      watchCount: 36,
      buyCount: 0,
      noBuyCount: 12,
      dipBuyerWatch: ["ABBV", "ACHV", "AEP", "AEE", "ADM", "AES"],
      dipBuyerBuy: [],
      dipBuyerNoBuy: ["AAPL", "AMD"],
      canslimWatch: [],
      canslimBuy: [],
      canslimNoBuy: ["MSFT"],
      messagePreview: "📈 Trading Advisor — Market Snapshot\n🎯 Decision: WATCH",
      completedAt: "2026-04-03T16:38:59.979Z",
      notifiedAt: "2026-04-03T16:40:00.000Z",
      correctionMode: false,
      lastError: null,
      sourceType: "artifact",
    },
  },
};

function findEventSource(url: string) {
  return MockEventSource.instances.find((instance) => instance.url === url);
}

describe("TradingOpsDashboard", () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {
        // Keep live polling dormant unless a test explicitly resolves it.
      })) as typeof fetch,
    );
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the terminal header and current Trading Ops shell", () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);

    expect(screen.getAllByText("Cortana Trading Ops").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Market Lab" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Watchlists" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Polymarket" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "System Health" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Deep Dive" })).not.toBeInTheDocument();
    expect(screen.getByText("Schwab live now")).toBeInTheDocument();
    expect(screen.getByText("Polymarket status")).toBeInTheDocument();
    expect(container).toHaveTextContent("Waiting for the first Schwab live quote poll.");
    expect(container).toHaveTextContent("Waiting for Polymarket services to settle after page load.");
    expect(container).toHaveTextContent("provider_cooldown: Wait.");
    expect(container).not.toHaveTextContent("Operator checklist");
    expect(container).not.toHaveTextContent("Operator verdict");
    expect(container).not.toHaveTextContent("Benchmark ladder");

    const systemHealthTab = screen.getByRole("tab", { name: "System Health" });
    fireEvent.mouseDown(systemHealthTab);
    fireEvent.click(systemHealthTab);
    expect(screen.getByText("Financial services health")).toBeInTheDocument();
    expect(container).toHaveTextContent("Schwab REST");
    expect(container).toHaveTextContent("Polymarket streamer");
    expect(container).toHaveTextContent("Schwab streamer");

    const watchlistsTab = screen.getByRole("tab", { name: "Watchlists" });
    fireEvent.mouseDown(watchlistsTab);
    fireEvent.click(watchlistsTab);
    expect(container).toHaveTextContent("Watchlists / Opportunity Board");
    expect(container).toHaveTextContent("Deterministic review priority. No Codex fanout, no buy/sell signal.");
    expect(container).toHaveTextContent("Core");
    expect(container).toHaveTextContent("Benchmarks");
    expect(container).toHaveTextContent("Score a watchlist to rank symbols for review.");
  });

  it("renders live tab data from the Schwab stream snapshot", async () => {
    const { container } = render(<TradingOpsDashboard data={fixture} />);

    expect(findEventSource("/api/trading-ops/live/stream")).toBeDefined();
    await act(async () => {
      findEventSource("/api/trading-ops/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-08T20:00:00.000Z",
        streamer: {
          connected: true,
          operatorState: "healthy",
          lastLoginAt: "2026-04-08T19:55:00.000Z",
          activeEquitySubscriptions: 8,
          activeAcctActivitySubscriptions: 1,
          cooldownSummary: null,
          warnings: [],
        },
        tape: {
          freshnessMessage: "Quotes are fresh from the Schwab streamer.",
          providerMode: "schwab_primary",
          fallbackEngaged: false,
          providerModeReason: "Quotes stayed on the Schwab primary lane.",
          rows: [
            liveRow("SPY", "SPY", "SPY", 510.12, 1.25),
            liveRow("QQQ", "QQQ", "QQQ", 441.18, 2.1),
            liveRow("IWM", "IWM", "IWM", 206.45, 1.05),
            liveRow("DOW", "DOW", "DIA", 389.45, 2.55),
            liveRow("NASDAQ", "NASDAQ", "QQQ", 441.18, 2.1),
            liveRow("GLD", "GLD", "GLD", 232.2, -0.33),
          ],
        },
        watchlists: {
          dipBuyer: {
            buy: [liveRow("ABBV", "ABBV", "ABBV", 179.1, 0.42)],
            watch: [liveRow("ACHV", "ACHV", "ACHV", 6.18, 4.5), liveRow("ADM", "ADM", "ADM", 63.77, 0.65)],
          },
          canslim: {
            buy: [liveRow("NVDA", "NVDA", "NVDA", 122.5, 3.22)],
            watch: [liveRow("MSFT", "MSFT", "MSFT", 427.9, 1.98)],
          },
        },
      meta: {
        runId: "20260403-163103",
        runLabel: "Apr 3, 12:38 PM",
        decision: "WATCH",
        focusTicker: "ABBV",
        isAfterHours: false,
        },
        warnings: [],
      });
    });

    const liveTab = screen.getByRole("tab", { name: "Live" });
    fireEvent.mouseDown(liveTab);
    fireEvent.click(liveTab);

    await waitFor(() => {
      expect(container).toHaveTextContent("Live tape");
      expect(container).toHaveTextContent("Streamer status");
      expect(container).toHaveTextContent("Connected");
      expect(container).toHaveTextContent("DOW");
      expect(container).toHaveTextContent("NASDAQ");
    });
  });

  it("renders the Polymarket tab content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-09T20:00:00.000Z",
            account: {
              state: "ok",
              label: "healthy",
              message: "Authenticated account is reachable with 0 balances, 0 positions, 0 open orders.",
              updatedAt: "2026-04-09T20:00:00.000Z",
              source: "/api/trading-ops/polymarket",
              warnings: [],
              badgeText: "...106dac",
              data: {
                status: "healthy",
                keyIdSuffix: "106dac",
                balanceCount: 0,
                positionCount: 0,
                openOrdersCount: 0,
                balances: [],
              },
            },
            signal: {
              state: "ok",
              label: "Signal artifact ready",
              message: "Risk-off confirmation",
              updatedAt: "2026-04-09T12:31:55.267Z",
              source: "/tmp/latest-report.json",
              warnings: [],
              badgeText: "confirms",
              data: {
                generatedAt: "2026-04-09T12:31:55.267Z",
                compactLines: [
                  "Polymarket: Fed easing odds 67% (0 pts/24h); Inflation upside risk 56% (+15 pts/24h); US recession odds 30% (-4 pts/24h)",
                ],
                alignment: "confirms",
                overlaySummary: "Risk-off confirmation",
                overlayDetail: "Polymarket risk-off signals align with a weak or degraded market regime.",
                conviction: "supportive",
                aggressionDial: "lean_more_selective",
                divergenceSummary: "No major divergence",
                topMarkets: [
                  {
                    slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
                    title: "Fed easing odds",
                    theme: "rates",
                    probability: 0.673,
                    change24h: -0.001,
                    severity: "major",
                    persistence: "one_off",
                    regimeEffect: "mixed",
                    watchTickers: ["QQQ", "NVDA", "AMD", "MSFT"],
                    qualityTier: "medium",
                  },
                ],
              },
            },
            watchlist: {
              state: "ok",
              label: "Watchlist ready",
              message: "Linked watchlist has 6 symbols across stocks, funds.",
              updatedAt: "2026-04-09T12:31:55.267Z",
              source: "/tmp/latest-watchlist.json",
              warnings: [],
              data: {
                updatedAt: "2026-04-09T12:31:55.267Z",
                totalCount: 6,
                buckets: {
                  stocks: ["AMD", "MSFT", "NVDA", "CVX"],
                  funds: ["QQQ", "XLE"],
                  crypto: [],
                  cryptoProxies: [],
                },
                symbols: [
                  {
                    symbol: "AMD",
                    assetClass: "stock",
                    themes: ["rates"],
                    sourceTitles: ["Fed easing odds"],
                    severity: "major",
                    persistence: "one_off",
                    probability: 0.673,
                    score: 0.7116,
                  },
                  {
                    symbol: "MSFT",
                    assetClass: "stock",
                    themes: ["rates"],
                    sourceTitles: ["Fed easing odds"],
                    severity: "major",
                    persistence: "one_off",
                    probability: 0.673,
                    score: 0.7116,
                  },
                ],
              },
            },
            results: {
              state: "ok",
              label: "Pinned results waiting",
              message: "Pinned markets will appear here after settlement.",
              updatedAt: "2026-04-09T12:31:55.267Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-09T12:31:55.267Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep the unrelated live snapshot fetches dormant; this test only exercises Polymarket.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-09T20:00:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["rdc-usfed-fomc-2026-04-29-cut25bps"],
          lastMarketMessageAt: "2026-04-09T20:00:01.000Z",
          lastPrivateMessageAt: "2026-04-09T20:00:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-09T20:00:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
            title: "Fed easing odds",
            bucket: "events",
            pinned: false,
            pinnedAt: null,
            eventTitle: "Fed Decision in April",
            league: null,
            bestBid: 0.41,
            bestAsk: 0.43,
            lastTrade: 0.42,
            spread: 0.02,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.42,
            tradeQuantity: 25,
            tradeTime: "2026-04-09T20:00:01.000Z",
            updatedAt: "2026-04-09T20:00:01.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await waitFor(() => {
      expect(container).toHaveTextContent("Signal overlay");
      expect(container).toHaveTextContent("Linked watchlist");
      expect(container).toHaveTextContent("Live stream");
      expect(container).toHaveTextContent("Fed easing odds");
      expect(container).toHaveTextContent("...106dac");
      expect(container).toHaveTextContent("$0.4100");
      expect(container).not.toHaveTextContent("Schwab market bridge");
    });
  });

  it("highlights roster changes when a new Polymarket board market enters", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-10T11:45:00.000Z",
            account: {
              state: "ok",
              label: "healthy",
              message: "Authenticated account is reachable with 0 balances, 0 positions, 0 open orders.",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/api/trading-ops/polymarket",
              warnings: [],
              badgeText: "...106dac",
              data: {
                status: "healthy",
                keyIdSuffix: "106dac",
                balanceCount: 0,
                positionCount: 0,
                openOrdersCount: 0,
                balances: [],
              },
            },
            signal: {
              state: "ok",
              label: "Signal artifact ready",
              message: "Neutral",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/tmp/latest-report.json",
              warnings: [],
              badgeText: "neutral",
              data: {
                generatedAt: "2026-04-10T11:45:00.000Z",
                compactLines: ["Polymarket: live event board ready"],
                alignment: "neutral",
                overlaySummary: "Neutral",
                overlayDetail: null,
                conviction: "neutral",
                aggressionDial: "steady",
                divergenceSummary: null,
                topMarkets: [],
              },
            },
            watchlist: {
              state: "ok",
              label: "Watchlist ready",
              message: "Linked watchlist has 0 symbols across stocks, funds.",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/tmp/latest-watchlist.json",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T11:45:00.000Z",
                totalCount: 0,
                buckets: {
                  stocks: [],
                  funds: [],
                  crypto: [],
                  cryptoProxies: [],
                },
                symbols: [],
              },
            },
            results: {
              state: "ok",
              label: "Pinned results waiting",
              message: "Pinned markets will appear here after settlement.",
              updatedAt: "2026-04-10T11:45:00.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T11:45:00.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-10T11:45:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["rdc-usfed-fomc-2026-04-29-cut25bps"],
          lastMarketMessageAt: "2026-04-10T11:45:01.000Z",
          lastPrivateMessageAt: "2026-04-10T11:45:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-10T11:45:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "rdc-usfed-fomc-2026-04-29-cut25bps",
            title: "Fed easing odds",
            bucket: "events",
            pinned: false,
            pinnedAt: null,
            eventTitle: "Fed Decision in April",
            league: null,
            bestBid: 0.41,
            bestAsk: 0.43,
            lastTrade: 0.42,
            spread: 0.02,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.42,
            tradeQuantity: 25,
            tradeTime: "2026-04-10T11:45:01.000Z",
            updatedAt: "2026-04-10T11:45:01.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Fed easing odds");
    });

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-10T11:46:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["cpic-uscpi-apr2026yoy-2026-05-12-3pt9pct"],
          lastMarketMessageAt: "2026-04-10T11:46:01.000Z",
          lastPrivateMessageAt: "2026-04-10T11:46:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-10T11:46:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "cpic-uscpi-apr2026yoy-2026-05-12-3pt9pct",
            title: "Exactly 3.9",
            bucket: "events",
            pinned: false,
            pinnedAt: null,
            eventTitle: "CPI year-over-year in April",
            league: null,
            bestBid: 0.08,
            bestAsk: 0.09,
            lastTrade: 0.09,
            spread: 0.01,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 300,
            openInterest: 900,
            tradePrice: 0.09,
            tradeQuantity: 5,
            tradeTime: "2026-04-10T11:46:01.000Z",
            updatedAt: "2026-04-10T11:46:01.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Exactly 3.9");
      expect(screen.getAllByText("NEW").length).toBeGreaterThan(0);
      expect(container).toHaveTextContent("1 new");
      expect(container).toHaveTextContent("Roster updated");
    });
  });

  it("keeps Polymarket panels neutral before the first live snapshot arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket" || url === "/api/trading-ops/polymarket/live") {
        throw new Error("temporary network issue");
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.fail();
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Waiting for Polymarket live streams to settle after page load.");
      expect(container).toHaveTextContent("Waiting for Polymarket account state.");
    });

    expect(container).not.toHaveTextContent("Polymarket live unavailable");
  });

  it("keeps reconnecting Polymarket payloads neutral while the live feed still looks like a cold start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T17:58:00.000Z"));

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T17:58:01.000Z",
            account: {
              state: "missing",
              label: "Loading account",
              message: "Waiting for the first Polymarket account snapshot.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: [],
              data: null,
              badgeText: "loading",
            },
            signal: {
              state: "missing",
              label: "Loading overlay",
              message: "Waiting for the first live Polymarket event snapshot.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: [],
              data: null,
              badgeText: "loading",
            },
            watchlist: {
              state: "missing",
              label: "Loading watchlist",
              message: "Waiting for the first linked Polymarket watchlist snapshot.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: [],
              data: null,
              badgeText: "loading",
            },
            results: {
              state: "missing",
              label: "Loading results",
              message: "Waiting for pinned market state.",
              updatedAt: "2026-04-16T17:58:01.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-16T17:58:01.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
              badgeText: "loading",
            },
          }),
        );
      }

      if (url === "/api/trading-ops/polymarket/live") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T17:58:01.000Z",
            streamer: {
              marketsConnected: false,
              privateConnected: false,
              operatorState: "reconnecting",
              trackedMarketCount: 0,
              trackedMarketSlugs: [],
              lastMarketMessageAt: null,
              lastPrivateMessageAt: null,
              lastError: "operation aborted",
            },
            account: {
              balance: null,
              buyingPower: null,
              openOrdersCount: 0,
              positionCount: 0,
              lastBalanceUpdateAt: null,
              lastOrdersUpdateAt: null,
              lastPositionsUpdateAt: null,
            },
            roster: {
              candidateEventsCount: 0,
              candidateSportsCount: 0,
            },
            markets: [],
            warnings: ["operation aborted"],
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1);
    });

    expect(container).toHaveTextContent("Waiting for Polymarket live streams to settle after page load.");
    expect(container).toHaveTextContent("Waiting for Polymarket account state.");

    expect(container).not.toHaveTextContent("Markets reconnecting");
    expect(container).not.toHaveTextContent("Live account stream is error.");

    await act(async () => {
      vi.advanceTimersByTime(12_001);
      await Promise.resolve();
    });

    expect(container).toHaveTextContent("Waiting for Polymarket live streams to settle after page load.");
    expect(container).toHaveTextContent("Waiting for Polymarket account state.");
    expect(container).not.toHaveTextContent("Live account stream is error.");
    expect(container).not.toHaveTextContent("One or more Polymarket streams are reconnecting.");
  });

  it("surfaces Polymarket failures after warmup when the live payload no longer looks like cold start loading", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T18:03:00.000Z"));

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T18:03:01.000Z",
            account: {
              state: "error",
              label: "error",
              message: "Live account stream is error. 0 live balance snapshots, 0 positions, 0 open orders.",
              updatedAt: "2026-04-16T18:03:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: ["focus temporarily degraded"],
              data: {
                status: "error",
                keyIdSuffix: null,
                balanceCount: 0,
                positionCount: 0,
                openOrdersCount: 0,
                balances: [],
              },
            },
            signal: {
              state: "missing",
              label: "No live event stream",
              message: "Polymarket event markets are not streaming yet.",
              updatedAt: "2026-04-16T18:03:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: ["focus temporarily degraded"],
              data: null,
            },
            watchlist: {
              state: "degraded",
              label: "Live linked watchlist degraded",
              message: "Live linked watchlist has 3 symbols across funds.",
              updatedAt: "2026-04-16T18:03:01.000Z",
              source: "/api/trading-ops/polymarket/live",
              warnings: ["focus temporarily degraded"],
              data: {
                updatedAt: "2026-04-16T18:03:01.000Z",
                totalCount: 3,
                buckets: {
                  stocks: [],
                  funds: ["SPY", "QQQ", "DIA"],
                  crypto: [],
                  cryptoProxies: [],
                },
                symbols: [],
              },
            },
            results: {
              state: "degraded",
              label: "Pinned results waiting",
              message: "Pinned markets will appear here after settlement.",
              updatedAt: "2026-04-16T18:03:01.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: ["HTTP 503: results backend unavailable"],
              data: {
                updatedAt: "2026-04-16T18:03:01.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      if (url === "/api/trading-ops/polymarket/live") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-16T18:03:01.000Z",
            streamer: {
              marketsConnected: false,
              privateConnected: false,
              operatorState: "degraded",
              trackedMarketCount: 0,
              trackedMarketSlugs: [],
              lastMarketMessageAt: "2026-04-16T18:02:58.000Z",
              lastPrivateMessageAt: null,
              lastError: "focus temporarily degraded",
            },
            account: {
              balance: null,
              buyingPower: null,
              openOrdersCount: 0,
              positionCount: 0,
              lastBalanceUpdateAt: null,
              lastOrdersUpdateAt: null,
              lastPositionsUpdateAt: null,
            },
            roster: {
              candidateEventsCount: 0,
              candidateSportsCount: 0,
            },
            markets: [],
            warnings: ["focus temporarily degraded"],
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(12_001);
      await Promise.resolve();
    });

    expect(container).toHaveTextContent("One or more Polymarket streams are reconnecting.");
    expect(container).toHaveTextContent("Live account stream is error. 0 live balance snapshots, 0 positions, 0 open orders.");
  });

  it("shows the freshest pinned market timestamp when quote updates are newer than the last trade", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/trading-ops/polymarket") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-04-10T12:00:00.000Z",
            account: {
              state: "ok",
              label: "healthy",
              message: "Authenticated account is reachable.",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/api/trading-ops/polymarket",
              warnings: [],
              badgeText: "...106dac",
              data: {
                status: "healthy",
                keyIdSuffix: "106dac",
                balanceCount: 0,
                positionCount: 0,
                openOrdersCount: 0,
                balances: [],
              },
            },
            signal: {
              state: "ok",
              label: "Signal artifact ready",
              message: "Neutral",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/tmp/latest-report.json",
              warnings: [],
              badgeText: "neutral",
              data: {
                generatedAt: "2026-04-10T12:00:00.000Z",
                compactLines: ["Polymarket: pinned market live"],
                alignment: "neutral",
                overlaySummary: "Neutral",
                overlayDetail: null,
                conviction: "neutral",
                aggressionDial: "steady",
                divergenceSummary: null,
                topMarkets: [],
              },
            },
            watchlist: {
              state: "ok",
              label: "Watchlist ready",
              message: "Linked watchlist has 0 symbols across stocks, funds.",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/tmp/latest-watchlist.json",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T12:00:00.000Z",
                totalCount: 0,
                buckets: { stocks: [], funds: [], crypto: [], cryptoProxies: [] },
                symbols: [],
              },
            },
            results: {
              state: "ok",
              label: "Pinned results waiting",
              message: "Pinned markets will appear here after settlement.",
              updatedAt: "2026-04-10T12:00:00.000Z",
              source: "/api/trading-ops/polymarket/results",
              warnings: [],
              data: {
                updatedAt: "2026-04-10T12:00:00.000Z",
                settledCount: 0,
                tradedCount: 0,
                openPositionCount: 0,
                rows: [],
              },
            },
          }),
        );
      }

      return new Promise<Response>(() => {
        // Keep unrelated fetches dormant.
      });
    }) as typeof fetch);

    const { container } = render(<TradingOpsDashboard data={fixture} />);

    const polymarketTab = screen.getByRole("tab", { name: "Polymarket" });
    fireEvent.mouseDown(polymarketTab);
    fireEvent.click(polymarketTab);

    await act(async () => {
      findEventSource("/api/trading-ops/polymarket/live/stream")?.emit("snapshot", {
        generatedAt: "2026-04-10T12:00:02.000Z",
        streamer: {
          marketsConnected: true,
          privateConnected: true,
          operatorState: "healthy",
          trackedMarketCount: 1,
          trackedMarketSlugs: ["fed-maintains"],
          lastMarketMessageAt: "2026-04-10T12:00:01.000Z",
          lastPrivateMessageAt: "2026-04-10T12:00:01.500Z",
          lastError: null,
        },
        account: {
          balance: 0,
          buyingPower: 0,
          openOrdersCount: 0,
          positionCount: 0,
          lastBalanceUpdateAt: "2026-04-10T12:00:01.500Z",
          lastOrdersUpdateAt: null,
          lastPositionsUpdateAt: null,
        },
        markets: [
          {
            slug: "fed-maintains",
            title: "Fed maintains rate",
            bucket: "events",
            pinned: true,
            pinnedAt: "2026-04-10T11:59:30.000Z",
            eventTitle: "Fed Decision in April",
            league: null,
            bestBid: 0.96,
            bestAsk: 0.97,
            lastTrade: 0.97,
            spread: 0.01,
            marketState: "MARKET_STATE_OPEN",
            sharesTraded: 1500,
            openInterest: 2100,
            tradePrice: 0.97,
            tradeQuantity: 25,
            tradeTime: "2026-04-10T11:41:00.000Z",
            updatedAt: "2026-04-10T12:02:00.000Z",
            state: "ok",
            warning: null,
          },
        ],
        warnings: [],
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent("Fed maintains rate");
      expect(container).toHaveTextContent("Apr 10, 8:02 AM");
      expect(container).not.toHaveTextContent("Apr 10, 7:41 AM");
    });
  });

  it("renders alert banner when incidents exist", () => {
    render(<TradingOpsDashboard data={fixture} />);
    expect(screen.getByText(/provider_cooldown: Wait\./)).toBeInTheDocument();
  });

  it("renders alert banner when latest trading run is in explicit fallback", () => {
    const fallbackFixture: TradingOpsDashboardData = {
      ...fixture,
      runtime: {
        ...fixture.runtime,
        state: "ok",
        message: "No operator action required.",
        warnings: [],
        data: fixture.runtime.data
          ? {
              ...fixture.runtime.data,
              incidents: [],
              operatorState: "healthy",
              operatorAction: "No operator action required.",
            }
          : fixture.runtime.data,
      },
      tradingRun: {
        ...fixture.tradingRun,
        state: "degraded",
        badgeText: "fallback",
        message: "Using file fallback because DB-backed trading run state is unavailable.",
      },
    };

    render(<TradingOpsDashboard data={fallbackFixture} />);
    expect(screen.getByText(/trading_run_state_fallback:/)).toBeInTheDocument();
  });

  it("renders runtime fallback alert without the removed readiness panel", () => {
    const staleFixture: TradingOpsDashboardData = {
      ...fixture,
      market: {
        ...fixture.market,
        badgeText: "stale",
        data: fixture.market.data
          ? {
              ...fixture.market.data,
              isStale: true,
              focusSymbols: [],
              referenceRunLabel: "Apr 7, 12:10 PM",
            }
          : fixture.market.data,
      },
      runtime: {
        ...fixture.runtime,
        data: fixture.runtime.data
          ? {
              ...fixture.runtime.data,
              preOpenGateStatus: "Readiness check unavailable",
              preOpenGateDetail: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
              preOpenGateFreshness: "Pre-open readiness check artifact is missing at /tmp/pre-open-canary-latest.json.",
              cooldownSummary: null,
              incidents: [],
              operatorState: "healthy",
              operatorAction: "No operator action required.",
            }
          : fixture.runtime.data,
        state: "ok",
        warnings: [],
        message: "No operator action required.",
      },
      tradingRun: {
        ...fixture.tradingRun,
        badgeText: "fallback",
        state: "degraded",
        data: fixture.tradingRun.data
          ? {
              ...fixture.tradingRun.data,
              sourceType: "file_fallback",
            }
          : fixture.tradingRun.data,
      },
    };

    const { container } = render(<TradingOpsDashboard data={staleFixture} />);
    expect(container).toHaveTextContent("trading_run_state_fallback");
    expect(container).not.toHaveTextContent("Pre-open readiness check");
  });
});

function liveRow(symbol: string, label: string, sourceSymbol: string, price: number, changePercent: number) {
  return {
    symbol,
    label,
    sourceSymbol,
    price,
    changePercent,
    source: "schwab_streamer",
    timestamp: "2026-04-08T20:00:00.000Z",
    state: "ok",
    warning: null,
  };
}
