import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import esbuild from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const uiRoot = path.join(pluginRoot, "ui");
const distRoot = path.join(uiRoot, "dist");

const cssEntry = path.join(uiRoot, "globals.css");
const jsEntry = path.join(uiRoot, "index.tsx");

async function buildCss() {
  const [postcssMod, tailwindMod, autoprefixerMod] = await Promise.all([
    import("postcss"),
    import("@tailwindcss/postcss"),
    import("autoprefixer"),
  ]);

  const postcss = postcssMod.default ?? postcssMod;
  const tailwindcss = tailwindMod.default ?? tailwindMod;
  const autoprefixer = autoprefixerMod.default ?? autoprefixerMod;

  const cssInput = await fs.readFile(cssEntry, "utf8");

  const previousCwd = process.cwd();
  process.chdir(uiRoot);
  try {
    const result = await postcss([tailwindcss(), autoprefixer]).process(cssInput, {
      from: cssEntry,
      to: path.join(distRoot, "globals.css"),
    });
    await fs.writeFile(path.join(distRoot, "globals.css"), result.css);
  } finally {
    process.chdir(previousCwd);
  }
}

async function buildJs() {
  await esbuild.build({
    entryPoints: [jsEntry],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["es2020"],
    outfile: path.join(distRoot, "index.js"),
    sourcemap: false,
    logLevel: "info",
    define: {
      "process.env.NODE_ENV": "\"production\"",
    },
  });
}

async function main() {
  await fs.mkdir(distRoot, { recursive: true });
  await Promise.all([buildCss(), buildJs()]);
  console.log(`Built UI assets in ${distRoot}`);
}

main().catch((err) => {
  console.error("UI build failed", err);
  process.exit(1);
});
