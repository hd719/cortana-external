import { describe, expect, it } from "vitest";
import {
  buildMissionControlLaunchAgentPlist,
  getMissionControlLaunchAgentEnvironment,
  getMissionControlLaunchAgentProgramArguments,
  getMissionControlRuntimeProfile,
  launchAgentUsesLegacyPnpmWrapper,
} from "@/lib/launch-agent";

describe("launch agent helpers", () => {
  it("builds a direct Mission Control launch agent plist", () => {
    const plist = buildMissionControlLaunchAgentPlist({
      appDir: "/tmp/apps/mission-control",
      programArguments: ["/tmp/apps/mission-control/scripts/start-mission-control.sh"],
      environmentVariables: {
        DATABASE_URL: "postgresql://hd@localhost:5432/cortana?connection_limit=10&pool_timeout=20",
        HOST: "0.0.0.0",
        NODE_ENV: "production",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        PORT: "3000",
        MARKET_LAB_ENV: "prod",
      },
    });

    expect(plist).toContain("<string>/tmp/apps/mission-control/scripts/start-mission-control.sh</string>");
    expect(plist).toContain("connection_limit=10&amp;pool_timeout=20");
    expect(plist).not.toContain("<string>/opt/homebrew/bin/pnpm</string>");
  });

  it("builds the standard direct start program arguments", () => {
    expect(getMissionControlLaunchAgentProgramArguments("/tmp/apps/mission-control")).toEqual([
      "/tmp/apps/mission-control/scripts/start-mission-control.sh",
    ]);
  });

  it("merges env defaults without losing explicit overrides", () => {
    const env = getMissionControlLaunchAgentEnvironment("/tmp/missing-app", {
      DATABASE_URL: "postgresql://override",
      HOST: "127.0.0.1",
      HEARTBEAT_STATE_PATH: "/srv/runtime/heartbeat-state.json",
      MISSION_CONTROL_API_TOKEN: "token-123",
      MISSION_CONTROL_PATH: "/custom/bin:/usr/bin:/bin",
      MISSION_CONTROL_URL: "http://100.120.198.12:3000",
      MARKET_LAB_ENV: "dev",
      NODE_ENV: "production",
      PORT: "4100",
      CORTANA_SOURCE_REPO: "/srv/cortana",
    });

    expect(env).toEqual({
      CORTANA_SOURCE_REPO: "/srv/cortana",
      DATABASE_URL: "postgresql://override",
      HOST: "127.0.0.1",
      HEARTBEAT_STATE_PATH: "/srv/runtime/heartbeat-state.json",
      MARKET_LAB_ENV: "dev",
      MISSION_CONTROL_API_TOKEN: "token-123",
      MISSION_CONTROL_URL: "http://100.120.198.12:3000",
      NODE_ENV: "production",
      PATH: "/custom/bin:/usr/bin:/bin",
      PORT: "4100",
    });
  });

  it("maps dev runtime profile to its own launchd label and port", () => {
    const profile = getMissionControlRuntimeProfile("dev");
    const env = getMissionControlLaunchAgentEnvironment("/tmp/missing-app", { DATABASE_URL: "postgresql://dev" }, profile);
    const plist = buildMissionControlLaunchAgentPlist({
      appDir: "/tmp/apps/mission-control",
      label: profile.label,
      programArguments: getMissionControlLaunchAgentProgramArguments("/tmp/apps/mission-control"),
      environmentVariables: env,
      stdoutPath: profile.stdoutPath,
      stderrPath: profile.stderrPath,
    });

    expect(profile.label).toBe("com.cortana.mission-control-dev");
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe("3001");
    expect(env.MARKET_LAB_ENV).toBe("dev");
    expect(plist).toContain("<string>com.cortana.mission-control-dev</string>");
    expect(plist).toContain("<string>/tmp/mission-control-dev-stdout.log</string>");
  });

  it("detects the legacy pnpm launch wrapper", () => {
    expect(
      launchAgentUsesLegacyPnpmWrapper(`
        <array>
          <string>/opt/homebrew/bin/pnpm</string>
          <string>start</string>
        </array>
      `),
    ).toBe(true);
    expect(
      launchAgentUsesLegacyPnpmWrapper(`
        <array>
          <string>/tmp/apps/mission-control/scripts/start-mission-control.sh</string>
        </array>
      `),
    ).toBe(false);
  });
});
