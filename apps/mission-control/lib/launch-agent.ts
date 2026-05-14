import path from "node:path";
import { loadMissionControlScriptEnv } from "./script-env";

export const MISSION_CONTROL_LAUNCH_AGENT_LABEL = "com.cortana.mission-control";
export const DEFAULT_MISSION_CONTROL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
export const DEFAULT_MISSION_CONTROL_HOST = "0.0.0.0";
export const DEFAULT_MISSION_CONTROL_PORT = "3000";
export const DEFAULT_MISSION_CONTROL_STDOUT = "/tmp/mission-control-stdout.log";
export const DEFAULT_MISSION_CONTROL_STDERR = "/tmp/mission-control-stderr.log";

export type MissionControlRuntimeEnv = "prod" | "dev";

export type MissionControlRuntimeProfile = {
  env: MissionControlRuntimeEnv;
  label: string;
  host: string;
  port: string;
  marketLabEnv: MissionControlRuntimeEnv;
  stdoutPath: string;
  stderrPath: string;
  healthUrl: string;
};

export type MissionControlLaunchAgentConfig = {
  appDir: string;
  label?: string;
  programArguments: string[];
  environmentVariables: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
};

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildMissionControlLaunchAgentPlist({
  appDir,
  label = MISSION_CONTROL_LAUNCH_AGENT_LABEL,
  programArguments,
  environmentVariables,
  stdoutPath = DEFAULT_MISSION_CONTROL_STDOUT,
  stderrPath = DEFAULT_MISSION_CONTROL_STDERR,
}: MissionControlLaunchAgentConfig): string {
  const envEntries = Object.entries(environmentVariables)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `\t\t<key>${xmlEscape(key)}</key>\n\t\t<string>${xmlEscape(value)}</string>`)
    .join("\n");

  const args = programArguments
    .map((argument) => `\t\t<string>${xmlEscape(argument)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>EnvironmentVariables</key>
\t<dict>
${envEntries}
\t</dict>
\t<key>KeepAlive</key>
\t<true/>
\t<key>Label</key>
\t<string>${xmlEscape(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${args}
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(stderrPath)}</string>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(stdoutPath)}</string>
\t<key>WorkingDirectory</key>
\t<string>${xmlEscape(appDir)}</string>
</dict>
</plist>
`;
}

export function getMissionControlRuntimeProfile(env: string | undefined = "prod"): MissionControlRuntimeProfile {
  if (env === "dev") {
    return {
      env: "dev",
      label: "com.cortana.mission-control-dev",
      host: DEFAULT_MISSION_CONTROL_HOST,
      port: "3001",
      marketLabEnv: "dev",
      stdoutPath: "/tmp/mission-control-dev-stdout.log",
      stderrPath: "/tmp/mission-control-dev-stderr.log",
      healthUrl: "http://127.0.0.1:3001/api/heartbeat-status",
    };
  }
  return {
    env: "prod",
    label: MISSION_CONTROL_LAUNCH_AGENT_LABEL,
    host: DEFAULT_MISSION_CONTROL_HOST,
    port: DEFAULT_MISSION_CONTROL_PORT,
    marketLabEnv: "prod",
    stdoutPath: DEFAULT_MISSION_CONTROL_STDOUT,
    stderrPath: DEFAULT_MISSION_CONTROL_STDERR,
    healthUrl: "http://127.0.0.1:3000/api/heartbeat-status",
  };
}

export function getMissionControlLaunchAgentEnvironment(
  appDir: string,
  env: NodeJS.ProcessEnv = process.env,
  profile: MissionControlRuntimeProfile = getMissionControlRuntimeProfile(env.MISSION_CONTROL_RUNTIME_ENV || env.MARKET_LAB_ENV || "prod"),
): Record<string, string> {
  const merged = loadMissionControlScriptEnv(appDir, { ...env });
  const environmentVariables: Record<string, string> = {
    DATABASE_URL: merged.DATABASE_URL?.trim() ?? "",
    HOST: merged.HOST?.trim() || profile.host,
    MARKET_LAB_ENV: merged.MARKET_LAB_ENV?.trim() || profile.marketLabEnv,
    NODE_ENV: merged.NODE_ENV?.trim() || "production",
    PATH: merged.MISSION_CONTROL_PATH?.trim() || DEFAULT_MISSION_CONTROL_PATH,
    PORT: merged.PORT?.trim() || profile.port,
  };

  for (const key of ["CORTANA_SOURCE_REPO", "DOCS_PATH", "RESEARCH_PATH", "KNOWLEDGE_PATH", "HEARTBEAT_STATE_PATH"]) {
    const value = merged[key]?.trim();
    if (value) {
      environmentVariables[key] = value;
    }
  }

  for (const key of ["MISSION_CONTROL_API_TOKEN", "MISSION_CONTROL_URL"]) {
    const value = merged[key]?.trim();
    if (value) {
      environmentVariables[key] = value;
    }
  }

  return environmentVariables;
}

export function getMissionControlLaunchAgentProgramArguments(appDir: string): string[] {
  return [path.join(appDir, "scripts", "start-mission-control.sh")];
}

export function launchAgentUsesLegacyPnpmWrapper(plistContent: string): boolean {
  return /<string>[^<]*pnpm<\/string>/.test(plistContent) && plistContent.includes("<string>start</string>");
}
