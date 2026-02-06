import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Artifact, ArtifactProvider } from "../artifacts";

type IndexEntry = {
  id: string;
  agent: string;
  filename: string;
  kind: string;
  title: string;
  description?: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
};

export function createEmptyOSArtifactProvider(emptyosHome: string): ArtifactProvider {
  const artifactsRoot = path.join(emptyosHome, "artifacts");
  const indexPath = path.join(artifactsRoot, "index.json");

  async function readIndex(): Promise<IndexEntry[]> {
    try {
      const raw = await fs.readFile(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  function entryToArtifact(entry: IndexEntry): Artifact {
    return {
      id: `emptyos:${entry.id}`,
      source: "emptyos",
      kind: entry.kind,
      title: entry.title,
      description: entry.description,
      mimeType: entry.mimeType,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      tags: entry.tags,
      sourceRef: entry.agent,
    };
  }

  return {
    id: "emptyos",

    async list(opts) {
      if (opts?.source && opts.source !== "emptyos") return [];
      const entries = await readIndex();
      let filtered = entries;
      if (opts?.kind) {
        filtered = filtered.filter((e) => e.kind === opts.kind);
      }
      return filtered.map(entryToArtifact);
    },

    async get(id) {
      const entryId = parseEntryId(id);
      if (!entryId) return null;
      const entries = await readIndex();
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return null;
      return entryToArtifact(entry);
    },

    async getContent(id) {
      const entryId = parseEntryId(id);
      if (!entryId) return null;
      const entries = await readIndex();
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) return null;
      const filePath = path.join(artifactsRoot, entry.agent, entry.filename);
      try {
        const data = await fs.readFile(filePath);
        return { data, mimeType: entry.mimeType };
      } catch (err: any) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
    },
  };
}

function parseEntryId(artifactId: string): string | null {
  const prefix = "emptyos:";
  if (!artifactId.startsWith(prefix)) return null;
  const entryId = artifactId.slice(prefix.length);
  return entryId || null;
}
