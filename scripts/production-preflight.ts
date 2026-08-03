import {
  validateDeploymentReadiness,
  type DeploymentTarget,
} from "../packages/config/src/index";

function targetFromArguments(arguments_: string[]): DeploymentTarget {
  const value = arguments_.find((argument) => argument.startsWith("--target="))?.split("=")[1];
  if (value === "staging" || value === "production") return value;
  throw new Error("Use --target=staging or --target=production");
}

const target = targetFromArguments(process.argv.slice(2));
const report = validateDeploymentReadiness(process.env, target);

if (!report.ok) {
  console.error(`Mensaly ${target} preflight failed with ${report.errors.length} issue(s):`);
  for (const error of report.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Mensaly ${target} preflight passed.`);
  console.log("No secret values were printed.");
}
