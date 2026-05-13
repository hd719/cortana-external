import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioTab } from "@/components/trading-ops/tabs/portfolio-tab";

const unavailablePortfolio = {
  status: "reauth_required",
  source: "schwab",
  generated_at: "2026-05-13T18:33:12.000Z",
  message: "Schwab account endpoints returned 401/403.",
  accounts: [],
  positions: [],
};

const availablePortfolio = {
  status: "available",
  source: "schwab",
  generated_at: "2026-05-13T18:52:09.000Z",
  message: null,
  accounts: [
    {
      account_hash: "acct-1",
      display_name: "Brokerage",
      account_type: "MARGIN",
      cash_value: 100,
      liquidation_value: 1000,
    },
  ],
  positions: [
    {
      account_hash: "acct-1",
      symbol: "AAPL",
      asset_type: "EQUITY",
      quantity: 2,
      average_price: 100,
      current_price: 110,
      cost_basis: 100,
      unrealized_pnl: 20,
      market_value: 220,
      weight_pct: 22,
      day_change: 1.5,
      day_change_pct: 1.4,
      quote_source: "schwab",
      quote_status: "live",
      quote_timestamp: "2026-05-13T18:52:09.000Z",
    },
  ],
  exposure_notes: [],
};

describe("PortfolioTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes once when the cached Schwab snapshot still needs reauth", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/latest")) return Response.json({ status: "ok", data: unavailablePortfolio });
      if (url.endsWith("/refresh")) return Response.json({ status: "ok", data: availablePortfolio });
      return Response.json({ status: "error", error: "unexpected url" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PortfolioTab />);

    expect((await screen.findAllByText("AAPL")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/market-lab/portfolio/latest",
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/market-lab/portfolio/refresh",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
