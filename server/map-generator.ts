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

  const apiUrl = process.env.NANO_BANANA_PRO_API_URL;
  const apiKey = process.env.NANO_BANANA_PRO_API_KEY;

  const outDir = storage.assetsDir(tripId);
  await fs.mkdir(outDir, { recursive: true });

  if (apiUrl && apiKey) {
    // Generic/placeholder integration; adjust to your API's expected schema.
    const prompt = `Generate a single map-style image that visualizes this trip itinerary as a route. Trip: ${tripName}. Destinations in order: ${destinations.join(" -> ")}. Dark theme.`;
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt, output_format: "png", width: 1200, height: 675 }),
    });
    if (!resp.ok) {
      throw new Error(`Nano Banana Pro request failed (${resp.status})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const assetPath = path.join(outDir, "itinerary-map.png");
    await fs.writeFile(assetPath, buf);
    return { assetPath, assetUrl: `/api/trips/${tripId}/assets/itinerary-map.png` };
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
  if (!itinerary.includes(marker)) {
    await storage.writeItinerary(tripId, `${line}\n\n${itinerary}`);
  }
}

