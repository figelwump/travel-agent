import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

type Options = {
  source: string;
  dest: string;
  includeUploads: boolean;
  includeAssets: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Usage: npx tsx openclaw/scripts/copy-legacy-data.ts [options]

Options:
  --source <path>          Legacy travel-agent data directory (default: $TRAVEL_AGENT_HOME or ~/.travelagent)
  --dest <path>            OpenClaw workspace root (default: openclaw/workspace)
  --include-uploads        Copy uploads/ directories
  --include-assets         Copy assets/ directories
  --help                   Show this help
`);
}

function parseArgs(argv: string[]): Options {
  const defaults: Options = {
    source: process.env.TRAVEL_AGENT_HOME || path.join(os.homedir(), ".travelagent"),
    dest: path.resolve(__dirname, "..", "workspace"),
    includeUploads: false,
    includeAssets: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--source" || arg === "--src") {
      defaults.source = argv[++i] || defaults.source;
      continue;
    }
    if (arg === "--dest" || arg === "--workspace") {
      defaults.dest = argv[++i] || defaults.dest;
      continue;
    }
    if (arg === "--include-uploads") {
      defaults.includeUploads = true;
      continue;
    }
    if (arg === "--include-assets") {
      defaults.includeAssets = true;
      continue;
    }
  }

  return defaults;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyFileIfExists(src: string, dest: string) {
  if (!(await exists(src))) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function copyDir(src: string, dest: string, options?: { skip?: Set<string> }) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (options?.skip?.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, options);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function copyDirIfExists(src: string, dest: string, options?: { skip?: Set<string> }) {
  if (!(await exists(src))) return;
  await copyDir(src, dest, options);
}

async function copyTrips(options: Options) {
  const tripsSrc = path.join(options.source, "trips");
  const tripsDest = path.join(options.dest, "trips");
  if (!(await exists(tripsSrc))) {
    console.log(`No trips directory found at ${tripsSrc}`);
    return;
  }

  const entries = await fs.readdir(tripsSrc, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const tripId = entry.name;
    const srcTripDir = path.join(tripsSrc, tripId);
    const destTripDir = path.join(tripsDest, tripId);
    await fs.mkdir(destTripDir, { recursive: true });
    await copyFileIfExists(path.join(srcTripDir, "trip.json"), path.join(destTripDir, "trip.json"));
    await copyFileIfExists(path.join(srcTripDir, "itinerary.md"), path.join(destTripDir, "itinerary.md"));
    await copyFileIfExists(path.join(srcTripDir, "context.md"), path.join(destTripDir, "context.md"));
    await copyDirIfExists(path.join(srcTripDir, "chats"), path.join(destTripDir, "chats"));

    if (options.includeUploads) {
      await copyDirIfExists(path.join(srcTripDir, "uploads"), path.join(destTripDir, "uploads"));
    }
    if (options.includeAssets) {
      await copyDirIfExists(path.join(srcTripDir, "assets"), path.join(destTripDir, "assets"));
    }
    copied += 1;
  }

  console.log(`Copied ${copied} trip(s) into ${tripsDest}`);
}

async function copyLegacyExtras(options: Options) {
  const legacyDir = path.join(options.dest, "legacy");
  await fs.mkdir(legacyDir, { recursive: true });
  await copyFileIfExists(path.join(options.source, "global-context.md"), path.join(legacyDir, "global-context.md"));
  await copyDirIfExists(path.join(options.source, "scheduler"), path.join(legacyDir, "scheduler"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Source: ${options.source}`);
  console.log(`Dest:   ${options.dest}`);

  if (!(await exists(options.source))) {
    console.error(`Source directory does not exist: ${options.source}`);
    process.exit(1);
  }

  await fs.mkdir(options.dest, { recursive: true });
  await copyTrips(options);
  await copyLegacyExtras(options);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
