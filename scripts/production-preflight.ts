import {
  validateDeploymentReadiness,
  validateSingleVpsReadiness,
  type DeploymentTarget,
} from "../packages/config/src/index";

const envFile = process.argv.slice(2)
  .find((argument) => argument.startsWith("--env-file="))
  ?.slice("--env-file=".length);
if (envFile) process.loadEnvFile(envFile);

type PreflightTarget = DeploymentTarget | "single-vps";

function targetFromArguments(arguments_: string[]): PreflightTarget {
  const value = arguments_.find((argument) => argument.startsWith("--target="))?.split("=")[1];
  if (value === "staging" || value === "production" || value === "single-vps") return value;
  throw new Error("Use --target=staging, --target=production or --target=single-vps");
}

const target = targetFromArguments(process.argv.slice(2));
const report = target === "single-vps"
  ? validateSingleVpsReadiness(process.env)
  : validateDeploymentReadiness(process.env, target);

if (!report.ok) {
  console.error(`Mensaly ${target} preflight failed with ${report.errors.length} issue(s):`);
  for (const error of report.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Mensaly ${target} preflight passed.`);
  console.log("No secret values were printed.");
}
