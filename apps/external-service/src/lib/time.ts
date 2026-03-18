export function isZeroOrInvalidDate(date: Date | null | undefined): boolean {
  if (!date) {
    return true;
  }

  const value = date.getTime();
  return Number.isNaN(value) || value <= 0;
}

export function toIsoString(date: Date): string {
  return date.toISOString();
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
