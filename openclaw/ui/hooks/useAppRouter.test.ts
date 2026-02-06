import { describe, expect, test } from "bun:test";
import { parseAppRoute, buildAppUrl, buildTravelUrl, slugify } from "./useAppRouter";

describe("parseAppRoute", () => {
  const base = "/agents/travel";

  test("root path returns home", () => {
    expect(parseAppRoute("/agents/travel", base)).toEqual({ page: "home" });
    expect(parseAppRoute("/agents/travel/", base)).toEqual({ page: "home" });
  });

  test("trips returns travel page", () => {
    expect(parseAppRoute("/agents/travel/trips", base)).toEqual({ page: "travel", tripId: undefined, conversationId: undefined });
  });

  test("trips with trip slug returns travel with tripId", () => {
    const result = parseAppRoute("/agents/travel/trips/paris-abc12345-1234-1234-1234-123456789012", base);
    expect(result.page).toBe("travel");
    expect(result).toHaveProperty("tripId", "abc12345-1234-1234-1234-123456789012");
  });

  test("trips with trip and conversation", () => {
    const result = parseAppRoute("/agents/travel/trips/trip-id-123/conv-456", base);
    expect(result.page).toBe("travel");
    expect(result).toHaveProperty("tripId", "trip-id-123");
    expect(result).toHaveProperty("conversationId", "conv-456");
  });

  test("artifacts returns artifacts page", () => {
    expect(parseAppRoute("/agents/travel/artifacts", base)).toEqual({ page: "artifacts", artifactId: undefined });
  });

  test("artifacts with id segments", () => {
    const result = parseAppRoute("/agents/travel/artifacts/travel/itinerary/trip123", base);
    expect(result.page).toBe("artifacts");
    expect(result).toHaveProperty("artifactId", "travel:itinerary:trip123");
  });

  test("chat returns chat page", () => {
    expect(parseAppRoute("/agents/travel/chat", base)).toEqual({ page: "chat" });
  });

  test("unknown path returns home", () => {
    expect(parseAppRoute("/agents/travel/unknown", base)).toEqual({ page: "home" });
  });
});

describe("buildAppUrl", () => {
  const base = "/agents/travel";

  test("home page", () => {
    expect(buildAppUrl({ page: "home" }, base)).toBe("/agents/travel");
  });

  test("travel page without trip", () => {
    expect(buildAppUrl({ page: "travel" }, base)).toBe("/agents/travel/trips");
  });

  test("travel page with trip", () => {
    expect(buildAppUrl({ page: "travel", tripId: "abc" }, base)).toBe("/agents/travel/trips/abc");
  });

  test("travel page with trip and conversation", () => {
    expect(buildAppUrl({ page: "travel", tripId: "abc", conversationId: "def" }, base)).toBe("/agents/travel/trips/abc/def");
  });

  test("artifacts page", () => {
    expect(buildAppUrl({ page: "artifacts" }, base)).toBe("/agents/travel/artifacts");
  });

  test("artifacts page with id", () => {
    expect(buildAppUrl({ page: "artifacts", artifactId: "travel:itinerary:abc" }, base)).toBe("/agents/travel/artifacts/travel/itinerary/abc");
  });

  test("chat page", () => {
    expect(buildAppUrl({ page: "chat" }, base)).toBe("/agents/travel/chat");
  });
});

describe("buildTravelUrl", () => {
  const base = "/agents/travel";

  test("without trip", () => {
    expect(buildTravelUrl(null, null, base)).toBe("/agents/travel/trips");
  });

  test("with trip id only", () => {
    expect(buildTravelUrl("abc", null, base)).toBe("/agents/travel/trips/abc");
  });

  test("with trip id and name slug", () => {
    expect(buildTravelUrl("abc", null, base, "Paris Trip")).toBe("/agents/travel/trips/paris-trip-abc");
  });

  test("with trip and conversation", () => {
    expect(buildTravelUrl("abc", "def", base, "Tokyo")).toBe("/agents/travel/trips/tokyo-abc/def");
  });
});

describe("slugify", () => {
  test("basic string", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("special characters", () => {
    expect(slugify("Paris & Tokyo!")).toBe("paris-tokyo");
  });

  test("accented characters", () => {
    expect(slugify("Café")).toBe("cafe");
  });

  test("empty returns null", () => {
    expect(slugify("")).toBeNull();
    expect(slugify(null)).toBeNull();
    expect(slugify(undefined)).toBeNull();
  });
});
