import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('context-profiler', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'token-optimizer-context-'));
    process.env.OPENCLAW_WORKSPACE = tempDir;
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCLAW_WORKSPACE;
  });

  it('estimateTokens() returns expected token counts', async () => {
    const { estimateTokens } = await import('../context-profiler.js');
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(0)).toBe(0);
  });

  it('profileFile() returns null for a non-existent file', async () => {
    const { profileFile } = await import('../context-profiler.js');
    expect(profileFile(join(tempDir, 'missing.md'))).toBeNull();
  });

  it('profileFile() returns expected structure for a real file', async () => {
    const { profileFile } = await import('../context-profiler.js');
    const filePath = join(tempDir, 'AGENTS.md');
    writeFileSync(filePath, 'a'.repeat(400));

    const result = profileFile(filePath);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      file: 'AGENTS.md',
      chars: 400,
      estimatedTokens: 100,
    });
  });

  it('profileWorkspace() returns files and totals', async () => {
    const { profileWorkspace } = await import('../context-profiler.js');

    writeFileSync(join(tempDir, 'SOUL.md'), 'b'.repeat(200));
    writeFileSync(join(tempDir, 'TOOLS.md'), 'c'.repeat(40));

    const profile = profileWorkspace();

    expect(Array.isArray(profile.files)).toBe(true);
    expect(profile.files.length).toBeGreaterThan(0);
    expect(profile.totalChars).toBe(
      profile.files.reduce((sum, f) => sum + f.chars, 0),
    );
    expect(profile.totalEstimatedTokens).toBe(
      profile.files.reduce((sum, f) => sum + f.estimatedTokens, 0),
    );
    expect(typeof profile.timestamp).toBe('string');
  });
});
