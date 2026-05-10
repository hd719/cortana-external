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
    expect(command.args.at(-1)).toBe("--json");
  });
});
