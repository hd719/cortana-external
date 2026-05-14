import { describe, expect, it } from "vitest";
import { buildMarketLabCommand, isValidMarketLabSymbol, normalizeMarketLabSymbol } from "@/lib/market-lab";

describe("market-lab library", () => {
  it("normalizes and validates symbols", () => {
    expect(normalizeMarketLabSymbol(" aapl ")).toBe("AAPL");
    expect(isValidMarketLabSymbol("AAPL")).toBe(true);
    expect(isValidMarketLabSymbol("../../../etc/passwd")).toBe(false);
  });

  it("builds uv command with argument array", () => {
    const command = buildMarketLabCommand("run", ["AAPL"]);

    expect(command.file).toBe("uv");
    expect(command.args).toContain("--project");
    expect(command.args).toContain("market_lab.cli");
    expect(command.args).toContain("AAPL");
    expect(command.args).toContain("--env");
    expect(command.args).toContain("prod");
    expect(command.args.at(-1)).toBe("--json");
  });

  it("builds settle-due command without a run id", () => {
    const command = buildMarketLabCommand("settle-due");

    expect(command.args).toContain("settle-due");
    expect(command.args.at(-1)).toBe("--json");
  });

  it("builds opportunity and portfolio commands through the uv bridge", () => {
    const opportunities = buildMarketLabCommand("opportunities", ["--symbols", "AAPL,MSFT"]);
    const portfolio = buildMarketLabCommand("portfolio", ["--refresh"]);

    expect(opportunities.args).toContain("opportunities");
    expect(opportunities.args).toContain("AAPL,MSFT");
    expect(portfolio.args).toContain("portfolio");
    expect(portfolio.args).toContain("--refresh");
  });
});
