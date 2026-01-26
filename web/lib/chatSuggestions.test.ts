import { describe, expect, test } from "bun:test";
import { buildChatSuggestions } from "./chatSuggestions";

describe("buildChatSuggestions", () => {
  test("prioritizes open todos from the itinerary", () => {
    const itinerary = [
      "- [ ] Book hotel in Reykjavik",
      "- [ ] Decide on glacier tour",
      "- [x] Book flights",
    ].join("\n");

    const suggestions = buildChatSuggestions("Iceland 2026", itinerary);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].label.startsWith("Book:")).toBe(true);
    expect(suggestions.some((s) => s.label.startsWith("Decide:"))).toBe(true);
  });

  test("surface placeholder questions when no todos exist", () => {
    const itinerary = ["Hotel: TBD", "Best area to stay?"].join("\n");

    const suggestions = buildChatSuggestions("Iceland 2026", itinerary);

    expect(suggestions.some((s) => s.label.startsWith("Fill in:"))).toBe(true);
    expect(suggestions.some((s) => s.label.startsWith("Answer:"))).toBe(true);
  });

  test("falls back to starter ideas when itinerary is empty", () => {
    const suggestions = buildChatSuggestions("Iceland 2026", "");

    expect(suggestions.some((s) => s.label === "Draft the itinerary")).toBe(true);
    expect(suggestions.some((s) => s.label === "Collect bookings")).toBe(true);
  });
});
