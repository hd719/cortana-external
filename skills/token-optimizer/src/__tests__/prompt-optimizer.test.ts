import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('prompt-optimizer', () => {
  let tempDir: string;

  async function loadModule() {
    vi.resetModules();
    return import('../prompt-optimizer.js');
  }

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'token-optimizer-cron-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.CRON_PATH;
  });

  it('suggests skills from payload keywords (gmail -> gog, whoop -> fitness-coach)', async () => {
    const cronPath = join(tempDir, 'cron-skills.json');
    process.env.CRON_PATH = cronPath;

    const jobs = [
      {
        id: 'job-skills',
        name: 'Skills detection',
        enabled: true,
        payload: { message: 'Please check gmail messages and pull whoop recovery insights.' },
      },
    ];
    writeFileSync(cronPath, JSON.stringify(jobs, null, 2));

    const { analyzeCronPayloads } = await loadModule();
    const result = analyzeCronPayloads();

    expect(result.length).toBe(1);
    expect(result[0].suggestedSkills).toContain('gog');
    expect(result[0].suggestedSkills).toContain('fitness-coach');
  });

  it('flags compression opportunities for large payloads and duplicate PATH exports', async () => {
    const cronPath = join(tempDir, 'cron-compress.json');
    process.env.CRON_PATH = cronPath;

    const longText = 'x'.repeat(3200);
    const payload = `export PATH=/usr/local/bin:$PATH\nexport PATH=/opt/homebrew/bin:$PATH\n${longText}`;

    const jobs = [
      {
        id: 'job-compress',
        name: 'Compression detection',
        enabled: true,
        payload: { message: payload },
      },
    ];
    writeFileSync(cronPath, JSON.stringify(jobs, null, 2));

    const { analyzeCronPayloads } = await loadModule();
    const [analysis] = analyzeCronPayloads();

    expect(analysis.payloadChars).toBeGreaterThan(3000);
    expect(analysis.compressionOpportunities).toContain(
      'Payload exceeds 3000 chars — consider splitting setup from instructions',
    );
    expect(analysis.compressionOpportunities).toContain(
      'Duplicate PATH exports — consolidate to one',
    );
  });

  it('analyzeCronPayloads() returns empty array when cron file is missing', async () => {
    process.env.CRON_PATH = join(tempDir, 'missing-cron.json');
    const { analyzeCronPayloads } = await loadModule();

    expect(analyzeCronPayloads()).toEqual([]);
  });
});
