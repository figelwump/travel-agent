import { describe, expect, test } from "bun:test";
import { createArtifactRegistry, type Artifact, type ArtifactProvider } from "./artifacts";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "test:1",
    source: "test",
    kind: "doc",
    title: "Test Artifact",
    mimeType: "text/plain",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProvider(id: string, artifacts: Artifact[]): ArtifactProvider {
  return {
    id,
    async list(opts) {
      let result = artifacts;
      if (opts?.source) result = result.filter((a) => a.source === opts.source);
      if (opts?.kind) result = result.filter((a) => a.kind === opts.kind);
      return result;
    },
    async get(artifactId) {
      return artifacts.find((a) => a.id === artifactId) ?? null;
    },
    async getContent(artifactId) {
      const a = artifacts.find((a) => a.id === artifactId);
      if (!a) return null;
      return { data: `content of ${artifactId}`, mimeType: a.mimeType };
    },
  };
}

describe("createArtifactRegistry", () => {
  test("list returns artifacts from all providers sorted by updatedAt", async () => {
    const registry = createArtifactRegistry();
    const older = makeArtifact({ id: "a:1", source: "a", updatedAt: "2025-01-01T00:00:00.000Z" });
    const newer = makeArtifact({ id: "b:1", source: "b", updatedAt: "2025-06-01T00:00:00.000Z" });
    registry.register(makeProvider("a", [older]));
    registry.register(makeProvider("b", [newer]));

    const results = await registry.list();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("b:1");
    expect(results[1].id).toBe("a:1");
  });

  test("list filters by source", async () => {
    const registry = createArtifactRegistry();
    registry.register(makeProvider("a", [makeArtifact({ id: "a:1", source: "a" })]));
    registry.register(makeProvider("b", [makeArtifact({ id: "b:1", source: "b" })]));

    const results = await registry.list({ source: "a" });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("a");
  });

  test("list filters by kind", async () => {
    const registry = createArtifactRegistry();
    registry.register(makeProvider("p", [
      makeArtifact({ id: "p:1", kind: "doc" }),
      makeArtifact({ id: "p:2", kind: "image" }),
    ]));

    const results = await registry.list({ kind: "image" });
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("image");
  });

  test("get finds artifact across providers", async () => {
    const registry = createArtifactRegistry();
    const artifact = makeArtifact({ id: "x:1" });
    registry.register(makeProvider("empty", []));
    registry.register(makeProvider("has-it", [artifact]));

    const found = await registry.get("x:1");
    expect(found).toBeTruthy();
    expect(found!.id).toBe("x:1");
  });

  test("get returns null when not found", async () => {
    const registry = createArtifactRegistry();
    registry.register(makeProvider("empty", []));

    const found = await registry.get("nonexistent");
    expect(found).toBeNull();
  });

  test("getContent returns content from correct provider", async () => {
    const registry = createArtifactRegistry();
    registry.register(makeProvider("p", [makeArtifact({ id: "p:1" })]));

    const content = await registry.getContent("p:1");
    expect(content).toBeTruthy();
    expect(content!.data).toBe("content of p:1");
  });

  test("getContent returns null when not found", async () => {
    const registry = createArtifactRegistry();
    registry.register(makeProvider("p", []));

    const content = await registry.getContent("nonexistent");
    expect(content).toBeNull();
  });

  test("register replaces existing provider with same id", async () => {
    const registry = createArtifactRegistry();
    registry.register(makeProvider("p", [makeArtifact({ id: "old" })]));
    registry.register(makeProvider("p", [makeArtifact({ id: "new" })]));

    const results = await registry.list();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("new");
  });

  test("list continues if a provider throws", async () => {
    const registry = createArtifactRegistry();
    const failing: ArtifactProvider = {
      id: "fail",
      async list() { throw new Error("boom"); },
      async get() { return null; },
      async getContent() { return null; },
    };
    registry.register(failing);
    registry.register(makeProvider("ok", [makeArtifact({ id: "ok:1" })]));

    const results = await registry.list();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("ok:1");
  });
});
