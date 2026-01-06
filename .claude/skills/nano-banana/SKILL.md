---
name: nano-banana
description: Generate images using the Nano Banana Pro API (Gemini image generation). Use when user asks to create, generate, or produce images for trips, destinations, activities, or any visual content.
allowed-tools: Read, Write, Bash, Glob
---

# Nano Banana Pro Image Generation

Generate images using the Nano Banana Pro API (backed by Gemini's image generation model).

## Configuration

**Resource root (do not `cd` here):** `$SKILL_ROOT` = `.claude/skills/nano-banana`

**Server module:** `server/nano-banana.ts` provides the TypeScript API.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NANO_BANANA_PRO_API_KEY` | Yes* | — | API key for Nano Banana Pro |
| `GEMINI_API_KEY` | Yes* | — | Fallback if `NANO_BANANA_PRO_API_KEY` not set |
| `NANO_BANANA_PRO_MODEL` | No | `gemini-2.0-flash-preview-image-generation` | Model to use |
| `NANO_BANANA_PRO_API_URL` | No | Auto-generated from model | Custom API endpoint |

*At least one API key must be set.

## API Usage (TypeScript)

### Check if configured

```typescript
import { isConfigured } from "./nano-banana";

if (!isConfigured()) {
  console.log("API key not set");
}
```

### Generate an image

```typescript
import { generateImage } from "./nano-banana";

const result = await generateImage({
  prompt: "A serene beach at sunset with palm trees",
  imageSize: "2K",      // "1K" | "2K" | "4K"
  aspectRatio: "16:9",  // "1:1" | "3:4" | "4:3" | "9:16" | "16:9"
});

// result.buffer   - Buffer containing the image data
// result.mimeType - e.g., "image/png"
// result.extension - e.g., "png", "jpg", "webp"
```

### Save to file

```typescript
import * as fs from "fs/promises";
import { generateImage } from "./nano-banana";

const result = await generateImage({
  prompt: "Tokyo street scene at night, neon lights, rain",
  aspectRatio: "16:9",
});

await fs.writeFile(`output.${result.extension}`, result.buffer);
```

## Prompt Guidelines

For best results:

1. **Be specific** - Include style, mood, lighting, composition details
2. **Mention format** - "photograph", "illustration", "map-style", "watercolor"
3. **Set the scene** - Time of day, weather, season
4. **Avoid text** - Image models struggle with text rendering

### Example Prompts

**Travel destination:**
```
A panoramic view of Santorini, Greece at golden hour.
White-washed buildings with blue domes cascading down the cliff.
Mediterranean Sea in the background. Warm, inviting atmosphere.
```

**Trip map:**
```
Create a single 16:9 map-style illustration that visualizes a trip route.
Trip: Japan Adventure. Destinations: Tokyo -> Kyoto -> Osaka -> Hiroshima.
Dark theme, crisp labels, subtle route line, minimal UI clutter.
```

**Activity illustration:**
```
Illustration of people hiking through a lush forest trail.
Dappled sunlight, tall trees, ferns. Peaceful and adventurous mood.
Flat illustration style with warm earth tones.
```

## Common Errors

- **"API key not configured"**: Set `NANO_BANANA_PRO_API_KEY` or `GEMINI_API_KEY` in your environment
- **"Request failed (400)"**: Check prompt for policy violations or unsupported content
- **"Response did not include image data"**: Model may have returned text only; try rephrasing the prompt

## Cross-Skill Transitions

- **After generating a map**: Use `travel-planner` to embed the image in an itinerary
- **For trip planning context**: Use `travel-planner` to understand what images are needed
