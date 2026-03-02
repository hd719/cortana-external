export type SessionKind = 'main' | 'cron-isolated' | 'cron-main' | 'subagent' | 'unknown';

export interface TokenEstimate {
  file: string;
  chars: number;
  estimatedTokens: number;
}

export interface ContextProfile {
  files: TokenEstimate[];
  totalChars: number;
  totalEstimatedTokens: number;
  timestamp: string;
}

export interface SessionUsage {
  sessionKey: string;
  sessionId: string;
  model: string;
  kind: SessionKind;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UsageReport {
  date: string;
  sessions: SessionUsage[];
  totalTokens: number;
  totalEstimatedCostUsd: number;
  topSpenders: SessionUsage[];
  byKind: Record<SessionKind, { count: number; tokens: number; costUsd: number }>;
}

export interface CronPayloadAnalysis {
  cronId: string;
  cronName: string;
  enabled: boolean;
  payloadChars: number;
  payloadEstimatedTokens: number;
  suggestedSkills: string[];
  compressionOpportunities: string[];
}

export interface OptimizationReport {
  contextProfile: ContextProfile;
  cronAnalysis: CronPayloadAnalysis[];
  totalCurrentTokensPerCronRun: number;
  totalOptimizedTokensPerCronRun: number;
  estimatedDailySavingsTokens: number;
  recommendations: string[];
}

export const MODEL_COSTS: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-sonnet-4-20250514': { input: 3, output: 15, cacheRead: 0.3 },
  'gpt-5.3-codex': { input: 2, output: 8, cacheRead: 0.5 },
  'gpt-5.1': { input: 1, output: 4, cacheRead: 0.25 },
};
