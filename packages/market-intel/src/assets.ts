import type { AssetClass } from "./types.js";

const CRYPTO_SPOT_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
]);

const CRYPTO_PROXY_SYMBOLS = new Set([
  "COIN",
  "HOOD",
  "MSTR",
  "MARA",
  "RIOT",
  "CLSK",
  "BITO",
  "IBIT",
  "ETHA",
  "HUT",
  "CIFR",
]);

const ETF_SYMBOLS = new Set([
  "QQQ",
  "IWM",
  "ARKK",
  "XLU",
  "XLV",
  "XLE",
  "JETS",
]);

export function classifySymbol(symbol: string): AssetClass {
  const normalized = symbol.trim().toUpperCase();

  if (CRYPTO_SPOT_SYMBOLS.has(normalized)) return "crypto";
  if (CRYPTO_PROXY_SYMBOLS.has(normalized)) return "crypto_proxy";
  if (ETF_SYMBOLS.has(normalized)) return "etf";
  return "stock";
}
