import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStorage } from "../storage";
import { createTravelArtifactProvider } from "./travel-artifacts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "travel-artifacts-test-"));
  tempDirs.push(dir);
  const storage = createStorage(dir);
  const provider = createTravelArtifactProvider(storage);
  return { storage, provider };
}

describe("travel artifact provider", () => {
  test("list returns empty when no trips exist", async () => {
    const { provider } = await setup();
    const results = await provider.list();
    expect(results).toHaveLength(0);
  });

  test("list returns itinerary artifacts for each trip", async () => {
    const { storage, provider } = await setup();
    await storage.createTrip("Paris");
    await storage.createTrip("Tokyo");

    const results = await provider.list();
    expect(results).toHaveLength(2);
    expect(results.every((a) => a.source === "travel")).toBe(true);
    expect(results.every((a) => a.kind === "itinerary")).toBe(true);
    expect(results.every((a) => a.mimeType === "text/markdown")).toBe(true);
  });

  test("list filters by source", async () => {
    const { storage, provider } = await setup();
    await storage.createTrip("Test");

    expect(await provider.list({ source: "travel" })).toHaveLength(1);
    expect(await provider.list({ source: "other" })).toHaveLength(0);
  });

  test("list filters by kind", async () => {
    const { storage, provider } = await setup();
    await storage.createTrip("Test");

    expect(await provider.list({ kind: "itinerary" })).toHaveLength(1);
    expect(await provider.list({ kind: "image" })).toHaveLength(0);
  });

  test("get returns artifact for valid trip", async () => {
    const { storage, provider } = await setup();
    const trip = await storage.createTrip("London");

    const artifact = await provider.get(`travel:itinerary:${trip.id}`);
    expect(artifact).toBeTruthy();
    expect(artifact!.id).toBe(`travel:itinerary:${trip.id}`);
    expect(artifact!.title).toContain("London");
  });

  test("get returns null for invalid id", async () => {
    const { provider } = await setup();
    expect(await provider.get("travel:itinerary:nonexistent")).toBeNull();
    expect(await provider.get("bad-id")).toBeNull();
    expect(await provider.get("travel:itinerary:")).toBeNull();
  });

  test("getContent returns itinerary markdown", async () => {
    const { storage, provider } = await setup();
    const trip = await storage.createTrip("Berlin");
    await storage.writeItinerary(trip.id, "# Berlin Trip\n\n- Day 1");

    const content = await provider.getContent(`travel:itinerary:${trip.id}`);
    expect(content).toBeTruthy();
    expect(content!.mimeType).toBe("text/markdown");
    expect(content!.data).toContain("# Berlin Trip");
  });

  test("getContent returns null for missing trip", async () => {
    const { provider } = await setup();
    expect(await provider.getContent("travel:itinerary:missing")).toBeNull();
  });
});
