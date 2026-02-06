export type Artifact = {
  id: string;
  source: string;
  kind: string;
  title: string;
  description?: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  sourceRef?: string;
};

export interface ArtifactProvider {
  id: string;
  list(opts?: { source?: string; kind?: string }): Promise<Artifact[]>;
  get(id: string): Promise<Artifact | null>;
  getContent(id: string): Promise<{ data: Buffer | string; mimeType: string } | null>;
}

export function createArtifactRegistry() {
  const providers: ArtifactProvider[] = [];

  function register(provider: ArtifactProvider): void {
    const existing = providers.findIndex((p) => p.id === provider.id);
    if (existing >= 0) {
      providers[existing] = provider;
    } else {
      providers.push(provider);
    }
  }

  async function list(opts?: { source?: string; kind?: string }): Promise<Artifact[]> {
    const results = await Promise.all(
      providers.map((p) => p.list(opts).catch(() => [] as Artifact[]))
    );
    const all = results.flat();
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return all;
  }

  async function get(id: string): Promise<Artifact | null> {
    for (const p of providers) {
      const artifact = await p.get(id);
      if (artifact) return artifact;
    }
    return null;
  }

  async function getContent(id: string): Promise<{ data: Buffer | string; mimeType: string } | null> {
    for (const p of providers) {
      const content = await p.getContent(id);
      if (content) return content;
    }
    return null;
  }

  return { register, list, get, getContent };
}
