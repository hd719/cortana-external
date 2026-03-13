import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAgentModelsPath,
  getCortanaSourceRepo,
  getDocsPath,
  getHeartbeatStatePath,
  getTelegramUsageHandlerPath,
} from "@/lib/runtime-paths";

describe("lib/runtime-paths", () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    delete process.env.CORTANA_SOURCE_REPO;
    delete process.env.DOCS_PATH;
    delete process.env.AGENT_MODELS_PATH;
    delete process.env.HEARTBEAT_STATE_PATH;
    delete process.env.TELEGRAM_USAGE_HANDLER_PATH;
    process.env.HOME = "/tmp/runtime-paths-home";
  });

  afterEach(() => {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it("uses canonical Cortana defaults when overrides are unset", () => {
    expect(getCortanaSourceRepo()).toBe("/Users/hd/Developer/cortana");
    expect(getDocsPath()).toBe("/Users/hd/Developer/cortana/docs");
    expect(getAgentModelsPath()).toBe("/Users/hd/Developer/cortana/config/agent-models.json");
    expect(getHeartbeatStatePath()).toBe("/tmp/runtime-paths-home/.openclaw/memory/heartbeat-state.json");
    expect(getTelegramUsageHandlerPath()).toBe(
      "/Users/hd/Developer/cortana/skills/telegram-usage/handler.ts"
    );
  });

  it("prefers explicit env overrides when provided", () => {
    process.env.CORTANA_SOURCE_REPO = "/srv/cortana";
    process.env.DOCS_PATH = "/srv/custom-docs";
    process.env.AGENT_MODELS_PATH = "/srv/custom-models.json";
    process.env.HEARTBEAT_STATE_PATH = "/srv/runtime/heartbeat-state.json";
    process.env.TELEGRAM_USAGE_HANDLER_PATH = "/srv/tools/telegram-usage.ts";

    expect(getCortanaSourceRepo()).toBe("/srv/cortana");
    expect(getDocsPath()).toBe("/srv/custom-docs");
    expect(getAgentModelsPath()).toBe("/srv/custom-models.json");
    expect(getHeartbeatStatePath()).toBe("/srv/runtime/heartbeat-state.json");
    expect(getTelegramUsageHandlerPath()).toBe("/srv/tools/telegram-usage.ts");
  });

  it("derives docs, models, and handler paths from CORTANA_SOURCE_REPO", () => {
    process.env.CORTANA_SOURCE_REPO = "/Volumes/cortana";

    expect(getDocsPath()).toBe("/Volumes/cortana/docs");
    expect(getAgentModelsPath()).toBe("/Volumes/cortana/config/agent-models.json");
    expect(getTelegramUsageHandlerPath()).toBe("/Volumes/cortana/skills/telegram-usage/handler.ts");
  });
});
