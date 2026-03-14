import { readFile } from "node:fs/promises";
import { z } from "zod";

import { DEFAULT_REGISTRY_PATH } from "./paths.js";
import type { Registry, RegistryEntry } from "./types.js";

const RegistryEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  theme: z.string().min(1),
  required: z.boolean().optional(),
  equityRelevance: z.enum(["high", "medium", "low"]),
  sectorTags: z.array(z.string()),
  watchTickers: z.array(z.string()),
  confidenceWeight: z.number().min(0).max(1),
  minLiquidity: z.number().min(0),
  active: z.boolean(),
  impactModel: z.enum([
    "fed_easing",
    "recession_risk",
    "inflation_upside",
    "tariff_risk",
    "geopolitical_escalation",
    "crypto_policy_support",
  ]),
  probabilityMode: z.enum(["direct", "invert"]).optional(),
  notes: z.string().optional(),
  selectors: z.object({
    marketSlugs: z.array(z.string()).default([]),
    eventSlugs: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),
    includeKeywords: z.array(z.string()).optional(),
    excludeKeywords: z.array(z.string()).optional(),
  }),
});

const RegistrySchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string().min(1),
  entries: z.array(RegistryEntrySchema),
});

export async function loadRegistry(path = DEFAULT_REGISTRY_PATH): Promise<Registry> {
  const raw = await readFile(path, "utf8");
  const parsed = RegistrySchema.parse(JSON.parse(raw));

  return {
    ...parsed,
    entries: parsed.entries.filter((entry) => entry.active),
  };
}

export function scoreRelevance(relevance: RegistryEntry["equityRelevance"]): number {
  if (relevance === "high") return 1;
  if (relevance === "medium") return 0.7;
  return 0.45;
}

export function matchesKeyword(entry: RegistryEntry, haystack: string): boolean {
  const normalized = haystack.toLowerCase();
  return entry.selectors.keywords.some((keyword) => {
    const tokens = keyword
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);

    if (tokens.length === 0) {
      return normalized.includes(keyword.toLowerCase());
    }

    return tokens.every((token) => {
      const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
      return pattern.test(normalized);
    });
  });
}

export function matchesSelectorFilters(entry: RegistryEntry, haystack: string): boolean {
  const normalized = haystack.toLowerCase();
  const includes = entry.selectors.includeKeywords ?? [];
  const excludes = entry.selectors.excludeKeywords ?? [];

  if (
    includes.length > 0 &&
    !includes.some((keyword) => normalized.includes(keyword.toLowerCase()))
  ) {
    return false;
  }

  if (
    excludes.some((keyword) => normalized.includes(keyword.toLowerCase()))
  ) {
    return false;
  }

  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
