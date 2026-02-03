#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "cli.ts");

if (!fs.existsSync(cliPath)) {
  process.stderr.write(`CLI entrypoint not found at ${cliPath}\n`);
  process.exit(1);
}

function resolveBunPath() {
  if (process.env.BUN_PATH) return process.env.BUN_PATH;
  if (process.env.BUN) return process.env.BUN;
  if (process.env.BUN_INSTALL) {
    const candidate = path.join(process.env.BUN_INSTALL, "bin", "bun");
    if (fs.existsSync(candidate)) return candidate;
  }
  const homeCandidate = path.join(os.homedir(), ".bun", "bin", "bun");
  if (fs.existsSync(homeCandidate)) return homeCandidate;
  return "bun";
}

const bunPath = resolveBunPath();
const result = spawnSync(bunPath, ["run", cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error && result.error.code === "ENOENT") {
  process.stderr.write("bun was not found. Install it with: curl -fsSL https://bun.sh/install | bash\n");
  process.stderr.write("If bun is already installed, add ~/.bun/bin to your PATH.\n");
  process.exit(1);
}

process.exit(result.status ?? 1);
