import { Buffer } from "buffer";

export interface NanoBananaConfig {
  apiKey?: string;
  model?: string;
  apiUrl?: string;
}

export interface ImageGenerationOptions {
  prompt: string;
  imageSize?: "1K" | "2K" | "4K";
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

function getConfig(): NanoBananaConfig {
  const apiKey = process.env.NANO_BANANA_PRO_API_KEY || process.env.GEMINI_API_KEY;
  const model = process.env.NANO_BANANA_PRO_MODEL || "gemini-3-pro-image-preview";
  const apiUrl =
    process.env.NANO_BANANA_PRO_API_URL ||
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return { apiKey, model, apiUrl };
}

export function isConfigured(): boolean {
  const { apiKey } = getConfig();
  return !!apiKey;
}

export async function generateImage(options: ImageGenerationOptions): Promise<GeneratedImage> {
  const { apiKey, apiUrl } = getConfig();

  if (!apiKey) {
    throw new Error(
      "Nano Banana Pro API key not configured. Set NANO_BANANA_PRO_API_KEY or GEMINI_API_KEY env var.",
    );
  }

  const imageSize = (options.imageSize || "2K").toUpperCase();
  const aspectRatio = options.aspectRatio || "16:9";

  const resp = await fetch(apiUrl!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: options.prompt }] }],
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

  const buffer = Buffer.from(data, "base64");
  const extension = mimeType.includes("jpeg")
    ? "jpg"
    : mimeType.includes("webp")
      ? "webp"
      : "png";

  return { buffer, mimeType, extension };
}
