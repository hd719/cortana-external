import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMissionControlLaunchAgentPlist,
  getMissionControlLaunchAgentEnvironment,
  getMissionControlLaunchAgentProgramArguments,
  getMissionControlRuntimeProfile,
} from "../lib/launch-agent";

const parseEnv = () => {
  const envArgIndex = process.argv.indexOf("--env");
  const raw = envArgIndex >= 0 ? process.argv[envArgIndex + 1] : process.env.MISSION_CONTROL_RUNTIME_ENV || process.env.MARKET_LAB_ENV || "prod";
  if (raw !== "prod" && raw !== "dev") {
    throw new Error("install-launch-agent.ts --env must be prod or dev.");
  }
  return raw;
};

const appDir = path.resolve(__dirname, "..");
const profile = getMissionControlRuntimeProfile(parseEnv());
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const launchAgentPath = path.join(launchAgentsDir, `${profile.label}.plist`);

fs.mkdirSync(launchAgentsDir, { recursive: true });

const environmentVariables = getMissionControlLaunchAgentEnvironment(appDir, process.env, profile);
if (!environmentVariables.DATABASE_URL) {
  throw new Error(`Mission Control LaunchAgent install aborted: DATABASE_URL is missing from ${path.join(appDir, ".env.local")} and the current environment.`);
}

const plist = buildMissionControlLaunchAgentPlist({
  appDir,
  label: profile.label,
  programArguments: getMissionControlLaunchAgentProgramArguments(appDir),
  environmentVariables,
  stdoutPath: profile.stdoutPath,
  stderrPath: profile.stderrPath,
});

fs.writeFileSync(launchAgentPath, plist, "utf8");
fs.chmodSync(launchAgentPath, 0o644);

process.stdout.write(`${launchAgentPath}\n`);
