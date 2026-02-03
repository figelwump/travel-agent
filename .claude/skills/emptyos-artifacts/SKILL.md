---
name: emptyos-artifacts
description: Publish files as shareable artifacts via EmptyOS. Use when generating or updating files the user might want to access later (PDFs, itineraries, exports, images, reports).
allowed-tools: Bash
---

# EmptyOS Artifact Publishing

Publish files to EmptyOS to make them accessible via shareable URLs. Use this whenever you generate or update files the user might want to access later.

## Configuration

**Artifacts storage:** `~/.emptyos/artifacts/`
**Index file:** `~/.emptyos/artifacts/index.json`
**URL format:** `https://you.ts.net/artifacts/<id>`

## Commands

### Publish an artifact

```bash
emptyos artifacts publish <path> --agent travel --description "<short summary>"
```

Returns a shareable URL on stdout.

### List artifacts

```bash
emptyos artifacts list                  # All artifacts
emptyos artifacts list --agent travel   # Filter by agent
```

Returns JSON array of artifact entries.

### Get artifact info

```bash
emptyos artifacts info <id>
```

Returns JSON with artifact details (name, path, agent, createdAt, description, mimeType, size).

### Remove an artifact

```bash
emptyos artifacts remove <id>
```

## When to Publish

- **Do publish:** PDFs, itineraries, exports, images, reports, or any file the user may want to access or share
- **Publish again:** When you update a file and want to surface the new version (publishing is a snapshot; updating the source file does not update the published copy)
- **Don't publish:** Temporary files, intermediate build artifacts, or files only used internally

## Workflow

1. Generate or update the file (e.g., export an itinerary to PDF)
2. Publish the file with a descriptive summary
3. Return the URL to the user so they can access it

## Examples

### Publishing a trip itinerary

```bash
emptyos artifacts publish /path/to/tokyo-itinerary.pdf --agent travel --description "Tokyo trip itinerary"
```

Output:
```
https://you.ts.net/artifacts/a3f2b1
```

### Publishing a trip map

```bash
emptyos artifacts publish ~/.travelagent/trips/abc123/assets/itinerary-map.png --agent travel --description "Japan trip route map"
```

### Listing travel artifacts

```bash
emptyos artifacts list --agent travel
```

Output:
```json
[
  {
    "id": "a3f2b1",
    "name": "tokyo-itinerary.pdf",
    "path": "travel/tokyo-itinerary.pdf",
    "agent": "travel",
    "createdAt": "2026-02-02T10:30:00.000Z",
    "description": "Tokyo trip itinerary",
    "mimeType": "application/pdf",
    "size": 245678
  }
]
```

## Common Errors

- **"file not found"**: The path doesn't exist. Verify the file was created successfully before publishing.
- **No output**: If the command produces no output, check that `emptyos` is installed and in PATH.

## Supported File Types

The following MIME types are auto-detected:

| Extension | MIME Type |
|-----------|-----------|
| `.pdf` | application/pdf |
| `.json` | application/json |
| `.txt` | text/plain |
| `.md` | text/markdown |
| `.csv` | text/csv |
| `.xlsx` | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| `.png` | image/png |
| `.jpg`, `.jpeg` | image/jpeg |
| `.svg` | image/svg+xml |

Other file types default to `application/octet-stream`.

## Cross-Skill Transitions

- **After generating images:** If using nano-banana to create images, publish them as artifacts so the user can download or share
- **After exporting itineraries:** When the travel agent generates a PDF or downloadable export, publish it
