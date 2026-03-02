import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('token-tracker', () => {
  let tempDir: string;

  async function loadModule() {
    vi.resetModules();
    return import('../token-tracker.js');
  }

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'token-optimizer-sessions-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SESSIONS_PATH;
  });

  it('classifySession() identifies all session kinds', async () => {
    process.env.SESSIONS_PATH = join(tempDir, 'unused.json');
    const { classifySession } = await loadModule();

    expect(classifySession('agent:main:main')).toBe('main');
    expect(classifySession('agent:main:cron:abc:run:def')).toBe('cron-isolated');
    expect(classifySession('agent:main:cron:abc')).toBe('cron-main');
    expect(classifySession('agent:main:subagent:abc')).toBe('subagent');
    expect(classifySession('random:key')).toBe('unknown');
  });

  it('loadSessionUsage() returns empty array when sessions file is missing', async () => {
    process.env.SESSIONS_PATH = join(tempDir, 'does-not-exist.json');
    const { loadSessionUsage } = await loadModule();
    expect(loadSessionUsage()).toEqual([]);
  });

  it('generateUsageReport() aggregates by kind and totals', async () => {
    const sessionsPath = join(tempDir, 'sessions.json');
    process.env.SESSIONS_PATH = sessionsPath;

    const mockSessions = {
      'agent:main:main': {
        sessionId: 's-main',
        model: 'gpt-5.3-codex',
        inputTokens: 1000,
        outputTokens: 500,
        cacheRead: 100,
        cacheWrite: 0,
      },
      'agent:main:cron:job1:run:abc': {
        sessionId: 's-cron-iso',
        model: 'gpt-5.3-codex',
        inputTokens: 700,
        outputTokens: 100,
        cacheRead: 200,
        cacheWrite: 0,
      },
      'agent:main:subagent:xyz': {
        sessionId: 's-sub',
        model: 'claude-opus-4-6',
        inputTokens: 300,
        outputTokens: 200,
        cacheRead: 0,
        cacheWrite: 0,
      },
    };

    writeFileSync(sessionsPath, JSON.stringify(mockSessions, null, 2));

    const { loadSessionUsage, generateUsageReport } = await loadModule();
    const sessions = loadSessionUsage();
    const report = generateUsageReport(sessions);

    expect(sessions.length).toBe(3);
    expect(report.totalTokens).toBe(3100);
    expect(report.sessions.length).toBe(3);
    expect(report.byKind.main.count).toBe(1);
    expect(report.byKind['cron-isolated'].count).toBe(1);
    expect(report.byKind.subagent.count).toBe(1);
    expect(report.byKind.main.tokens).toBe(1600);
    expect(report.byKind['cron-isolated'].tokens).toBe(1000);
    expect(report.byKind.subagent.tokens).toBe(500);
    expect(report.totalEstimatedCostUsd).toBeGreaterThan(0);
  });
});
