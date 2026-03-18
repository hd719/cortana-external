import { describe, expect, it } from "vitest";

import { buildOrderPayload, normalizeSide } from "../alpaca/service.js";

describe("alpaca helpers", () => {
  it("normalizes trade side", () => {
    expect(normalizeSide("BUY")).toBe("buy");
    expect(normalizeSide(" sell ")).toBe("sell");
    expect(normalizeSide("hold")).toBe("");
  });

  it("builds default market order payload", () => {
    const payload = buildOrderPayload({ symbol: "AAPL", side: "buy", qty: 1.5 }, "AAPL", "buy");
    expect(payload).toEqual({
      symbol: "AAPL",
      side: "buy",
      type: "market",
      time_in_force: "day",
      qty: 1.5,
    });
  });

  it("requires limit_price for limit orders", () => {
    expect(() => buildOrderPayload({ symbol: "AAPL", side: "buy", order_type: "limit", qty: 1 }, "AAPL", "buy")).toThrow(
      "limit_price is required for limit orders",
    );
  });

  it("formats stop_limit payload", () => {
    const payload = buildOrderPayload(
      {
        symbol: "AAPL",
        side: "buy",
        order_type: "stop_limit",
        time_in_force: "gtc",
        qty: 2,
        limit_price: 100.125,
        stop_price: 98.5,
      },
      "AAPL",
      "buy",
    );

    expect(payload).toEqual({
      symbol: "AAPL",
      side: "buy",
      type: "stop_limit",
      time_in_force: "gtc",
      qty: 2,
      limit_price: "100.13",
      stop_price: "98.50",
    });
  });
});
