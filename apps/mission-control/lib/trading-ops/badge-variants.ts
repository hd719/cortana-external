import type {
  FinancialServiceHealthRow,
  TradingOpsLiveData,
  TradingOpsPolymarketLiveData,
} from "@/lib/trading-ops-contract";

export function badgeVariantForStreamer(streamer: TradingOpsLiveData["streamer"]) {
  if (streamer.connected && streamer.operatorState === "healthy") return "success" as const;
  if (streamer.connected) return "warning" as const;
  return "info" as const;
}

export function badgeVariantForServiceHealth(state: FinancialServiceHealthRow["state"]) {
  if (state === "ok") return "success" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "error") return "destructive" as const;
  return "outline" as const;
}

export function badgeVariantForMarketSeverity(severity: string) {
  if (severity === "major") return "warning" as const;
  if (severity === "notable") return "info" as const;
  return "outline" as const;
}

export function badgeVariantForPolymarketStreamer(data: TradingOpsPolymarketLiveData) {
  if (data.streamer.marketsConnected && data.streamer.privateConnected) return "success" as const;
  if (data.streamer.marketsConnected || data.streamer.privateConnected) return "warning" as const;
  return "outline" as const;
}
