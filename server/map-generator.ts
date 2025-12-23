import * as fs from "fs/promises";
import * as path from "path";
import { Buffer } from "buffer";
import * as storage from "./storage";

function generateFallbackTripMapSvg(tripName: string, destinations: string[]): string {
  const escaped = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const items = destinations
    .slice(0, 12)
    .map(
      (d, i) =>
        `<text x="24" y="${80 + i * 22}" fill="#f6e7c7" font-size="14" font-family="monospace">${i + 1}. ${escaped(d)}</text>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#0b0c10"/>
  <rect x="20" y="20" width="1160" height="635" fill="#12141c" stroke="#b0892e" stroke-width="2"/>
  <text x="24" y="52" fill="#f6e7c7" font-size="22" font-family="serif" font-style="italic">${escaped(tripName)} — Trip Map (placeholder)</text>
  <text x="24" y="74" fill="#cdbf9a" font-size="12" font-family="monospace">Set NANO_BANANA_PRO_* env vars to enable generated maps</text>
  ${items}
</svg>`;
}

export async function generateTripMapAsset(
  tripId: string,
  destinations: string[],
): Promise<{ assetPath: string; assetUrl: string }> {
  const trip = await storage.getTrip(tripId);
  const tripName = trip?.name ?? tripId;

  const apiKey = process.env.NANO_BANANA_PRO_API_KEY || process.env.GEMINI_API_KEY;
  const model = process.env.NANO_BANANA_PRO_MODEL || "gemini-3-pro-image-preview";
  const imageSize = (process.env.NANO_BANANA_PRO_IMAGE_SIZE || "2K").toUpperCase();
  const aspectRatio = process.env.NANO_BANANA_PRO_ASPECT_RATIO || "16:9";
  const apiUrl =
    process.env.NANO_BANANA_PRO_API_URL ||
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const outDir = storage.assetsDir(tripId);
  await fs.mkdir(outDir, { recursive: true });

  if (apiKey) {
    const prompt = [
      "Create a single 16:9 map-style illustration that visualizes this trip itinerary as a route.",
      `Trip: ${tripName}.`,
      `Destinations in order: ${destinations.join(" -> ")}.`,
      "Dark theme, crisp labels, subtle route line, minimal UI clutter.",
    ].join(" ");
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { imageSize, aspectRatio },
        },
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => resp.statusText);
      throw new Error(`Nano Banana Pro request failed (${resp.status}): ${detail}`);
    }
    const payload: any = await resp.json();
    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data);
    const data = inline?.inlineData?.data || inline?.inline_data?.data;
    const mimeType = inline?.inlineData?.mimeType || inline?.inline_data?.mime_type || "image/png";
    if (!data || typeof data !== "string") {
      throw new Error("Nano Banana Pro response did not include image data.");
    }
    const buf = Buffer.from(data, "base64");
    const ext = mimeType.includes("jpeg")
      ? "jpg"
      : mimeType.includes("webp")
        ? "webp"
        : mimeType.includes("png")
          ? "png"
          : "png";
    const assetPath = path.join(outDir, `itinerary-map.${ext}`);
    await fs.writeFile(assetPath, buf);
    return { assetPath, assetUrl: `/api/trips/${tripId}/assets/itinerary-map.${ext}` };
  }

  const svg = generateFallbackTripMapSvg(tripName, destinations);
  const assetPath = path.join(outDir, "itinerary-map.svg");
  await fs.writeFile(assetPath, svg, "utf8");
  return { assetPath, assetUrl: `/api/trips/${tripId}/assets/itinerary-map.svg` };
}

export async function ensureMapReferencedInItinerary(tripId: string, assetUrl: string): Promise<void> {
  const itinerary = await storage.readItinerary(tripId);
  const marker = "![Trip map]";
  const line = `${marker}(${assetUrl})`;
  if (itinerary.includes(marker)) {
    const next = itinerary.replace(/!\[Trip map\]\([^)]+\)/, line);
    if (next !== itinerary) {
      await storage.writeItinerary(tripId, next);
    }
    return;
  }
  await storage.writeItinerary(tripId, `${line}\n\n${itinerary}`);
}
