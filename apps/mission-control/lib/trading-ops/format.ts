export function formatSignedPercentLabel(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

export function compactValue(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ") || "n/a";
}

export function formatLabel(value: string | null | undefined): string {
  if (!value) return "n/a";
  return value.replaceAll("_", " ");
}

export function formatProbability(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

export function formatProbabilityDelta(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "24h n/a";
  const points = Math.round(value * 100);
  const sign = points > 0 ? "+" : "";
  return `${sign}${points} pts/24h`;
}

export function formatMarketPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(value >= 1 ? 3 : 4)}`;
}

export function formatMarketQuantity(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value >= 1000 ? value.toLocaleString() : String(Number(value.toFixed(2)));
}

export function formatDetailedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatSignedDetailedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatDetailedMoney(Math.abs(value))}`;
}

export function signedValueTextClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "text-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
