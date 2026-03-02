import { profileWorkspace, printContextProfile } from './context-profiler.js';
import { loadSessionUsage, generateUsageReport, printUsageReport } from './token-tracker.js';
import { generateOptimizationReport, printOptimizationReport } from './prompt-optimizer.js';

const args = process.argv.slice(2);
const command = args[0] || '--help';

switch (command) {
  case '--profile':
    printContextProfile(profileWorkspace());
    break;

  case '--usage':
    printUsageReport(generateUsageReport(loadSessionUsage()));
    break;

  case '--optimize':
    printOptimizationReport(generateOptimizationReport());
    break;

  case '--all':
    printContextProfile(profileWorkspace());
    printUsageReport(generateUsageReport(loadSessionUsage()));
    printOptimizationReport(generateOptimizationReport());
    break;

  default:
    console.log(`
Token Optimizer — OpenClaw token usage analysis and optimization

Usage:
  npx tsx src/index.ts --profile     Profile workspace bootstrap context
  npx tsx src/index.ts --usage       Show today's token usage by session
  npx tsx src/index.ts --optimize    Generate optimization recommendations
  npx tsx src/index.ts --all         Run all reports
`);
}
