import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
  default: { execSync: execSyncMock },
}));

import {
  parseEnvFileContent,
  updateEnvContent,
  updateServicesWorkspaceData,
  writeEnvFileAtomically,
} from "@/lib/service-workspace";

describe("lib/service-workspace", () => {
  let tempRoot: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    execSyncMock.mockImplementation(() => {
      throw new Error("openclaw unavailable");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }) as typeof fetch,
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("parses quoted values and inline comments", () => {
    const parsed = parseEnvFileContent(
      [
        "# comment",
        "PLAIN=value # keep",
        'DOUBLE=\"line # literal\"',
        "SINGLE='two words'",
        'EMPTY=""',
      ].join("\n"),
    );

    expect(parsed).toEqual({
      PLAIN: "value",
      DOUBLE: "line # literal",
      SINGLE: "two words",
      EMPTY: "",
    });
  });

  it("updates env content while preserving spacing, comments, and de-duping keys", () => {
    const updated = updateEnvContent(
      [
        "# header",
        " export FOO = old-value # preserve",
        "BAR=1",
        "FOO=stale",
        "",
      ].join("\n"),
      "FOO",
      "next value",
    );

    expect(updated).toContain(' export FOO = "next value" # preserve');
    expect(updated).toContain("BAR=1");
    expect(updated.match(/FOO\s*=/g)).toHaveLength(1);

    const deleted = updateEnvContent(updated, "BAR", null);
    expect(deleted).not.toContain("BAR=1");
  });

  it("writes env files atomically through a temp-file rename", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mc-env-atomic-"));
    const filePath = path.join(tempRoot, ".env");
    const renameSpy = vi.spyOn(fs, "renameSync");

    try {
      writeEnvFileAtomically(filePath, "PORT=3033\n");

      await expect(readFile(filePath, "utf8")).resolves.toBe("PORT=3033\n");
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy.mock.calls[0]?.[0]).toContain(".tmp");
      expect(renameSpy.mock.calls[0]?.[1]).toBe(filePath);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("updates the modeled workspace files without dropping unrelated keys", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mc-services-workspace-"));
    await mkdir(path.join(tempRoot, ".git"));
    await mkdir(path.join(tempRoot, "apps", "mission-control"), { recursive: true });

    await writeFile(
      path.join(tempRoot, ".env"),
      ["WHOOP_CLIENT_ID=old-client", "EXTRA_KEY=keep", "WHOOP_CLIENT_ID=stale"].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(tempRoot, "apps", "mission-control", ".env.local"),
      ["# mission control", "OPENCLAW_EVENT_TOKEN=secret-token # preserve"].join("\n"),
      "utf8",
    );

    const data = await updateServicesWorkspaceData(
      [
        { fileId: "external", key: "WHOOP_CLIENT_ID", value: "new-client" },
        { fileId: "missionControl", key: "OPENCLAW_EVENT_TOKEN", value: null },
        { fileId: "missionControl", key: "DOCS_PATH", value: "/tmp/docs" },
      ],
      { rootDir: tempRoot },
    );

    const externalContent = await readFile(path.join(tempRoot, ".env"), "utf8");
    const missionControlContent = await readFile(
      path.join(tempRoot, "apps", "mission-control", ".env.local"),
      "utf8",
    );

    expect(externalContent).toContain("WHOOP_CLIENT_ID=new-client");
    expect(externalContent.match(/WHOOP_CLIENT_ID=/g)).toHaveLength(1);
    expect(externalContent).toContain("EXTRA_KEY=keep");

    expect(missionControlContent).toContain("# mission control");
    expect(missionControlContent).not.toContain("OPENCLAW_EVENT_TOKEN");
    expect(missionControlContent).toContain("DOCS_PATH=/tmp/docs");

    expect(data.files.find((file) => file.id === "external")?.exists).toBe(true);
    expect(data.files.find((file) => file.id === "missionControl")?.exists).toBe(true);
  });

  it("models the WHOOP streaming config section for external-service env", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mc-services-workspace-"));
    await mkdir(path.join(tempRoot, ".git"));
    await mkdir(path.join(tempRoot, "apps", "mission-control"), { recursive: true });
    await writeFile(path.join(tempRoot, ".env"), "WHOOP_WEBHOOK_ENABLED=true\n", "utf8");

    const data = await updateServicesWorkspaceData([], { rootDir: tempRoot });
    const section = data.sections.find((item) => item.id === "whoop-streaming");

    expect(section?.label).toBe("WHOOP Streaming");
    expect(section?.fileId).toBe("external");
    expect(section?.fields.map((field) => field.key)).toEqual([
      "WHOOP_WEBHOOK_ENABLED",
      "WHOOP_WEBHOOK_PUBLIC_URL",
      "WHOOP_WEBHOOK_SECRET",
      "CORTANA_DATABASE_URL",
      "WHOOP_WEBHOOK_REPLAY_WINDOW_SECONDS",
      "WHOOP_WEBHOOK_RAW_RETENTION_DAYS",
      "WHOOP_WEBHOOK_COALESCE_WINDOW_MS",
      "WHOOP_WEBHOOK_PROCESSOR_INTERVAL_MS",
      "WHOOP_WEBHOOK_PROCESS_BATCH_SIZE",
      "WHOOP_WEBHOOK_BODY_LIMIT_BYTES",
      "WHOOP_LIVE_EVENT_TELEGRAM_ENABLED",
      "WHOOP_LIVE_EVENT_TELEGRAM_ACCOUNT_ID",
    ]);
    expect(section?.fields.find((field) => field.key === "WHOOP_WEBHOOK_ENABLED")?.currentValue).toBe("true");
  });
});
