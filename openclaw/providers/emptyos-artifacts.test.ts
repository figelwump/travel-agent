import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyOSArtifactProvider } from "./emptyos-artifacts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const emptyosHome = await mkdtemp(path.join(tmpdir(), "emptyos-artifacts-test-"));
  tempDirs.push(emptyosHome);
  const provider = createEmptyOSArtifactProvider(emptyosHome);
  return { emptyosHome, provider };
}

async function writeIndex(emptyosHome: string, entries: any[]) {
  const artifactsDir = path.join(emptyosHome, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(path.join(artifactsDir, "index.json"), JSON.stringify(entries), "utf8");
}

async function writeArtifactFile(emptyosHome: string, agent: string, filename: string, content: string) {
  const dir = path.join(emptyosHome, "artifacts", agent);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), content, "utf8");
}

const sampleEntry = {
  id: "abc123",
  agent: "notes",
  filename: "note.md",
  kind: "note",
  title: "My Note",
  description: "A sample note",
  mimeType: "text/markdown",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
  tags: ["test"],
};

describe("emptyos artifact provider", () => {
  test("list returns empty when no index exists", async () => {
    const { provider } = await setup();
    const results = await provider.list();
    expect(results).toHaveLength(0);
  });

  test("list returns artifacts from index", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);

    const results = await provider.list();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("emptyos:abc123");
    expect(results[0].source).toBe("emptyos");
    expect(results[0].kind).toBe("note");
    expect(results[0].title).toBe("My Note");
    expect(results[0].tags).toEqual(["test"]);
  });

  test("list filters by source", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);

    expect(await provider.list({ source: "emptyos" })).toHaveLength(1);
    expect(await provider.list({ source: "other" })).toHaveLength(0);
  });

  test("list filters by kind", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);

    expect(await provider.list({ kind: "note" })).toHaveLength(1);
    expect(await provider.list({ kind: "image" })).toHaveLength(0);
  });

  test("get returns artifact by id", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);

    const artifact = await provider.get("emptyos:abc123");
    expect(artifact).toBeTruthy();
    expect(artifact!.id).toBe("emptyos:abc123");
    expect(artifact!.title).toBe("My Note");
  });

  test("get returns null for missing id", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);

    expect(await provider.get("emptyos:missing")).toBeNull();
    expect(await provider.get("bad-prefix")).toBeNull();
  });

  test("getContent reads file from disk", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);
    await writeArtifactFile(emptyosHome, "notes", "note.md", "# My Note Content");

    const content = await provider.getContent("emptyos:abc123");
    expect(content).toBeTruthy();
    expect(content!.mimeType).toBe("text/markdown");
    expect(content!.data.toString()).toContain("# My Note Content");
  });

  test("getContent returns null when file missing", async () => {
    const { emptyosHome, provider } = await setup();
    await writeIndex(emptyosHome, [sampleEntry]);
    // Don't write the actual file

    expect(await provider.getContent("emptyos:abc123")).toBeNull();
  });

  test("getContent returns null for missing entry", async () => {
    const { provider } = await setup();
    expect(await provider.getContent("emptyos:nonexistent")).toBeNull();
  });
});
