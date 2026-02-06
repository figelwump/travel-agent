import React, { useCallback, useEffect, useState } from "react";
import type { AppPage } from "../hooks/useAppRouter";

const EMPTYOS_API = "/agents/travel/api";

type Artifact = {
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

type ArtifactsPageProps = {
  initialArtifactId?: string;
  onNavigate: (route: AppPage) => void;
};

export const ArtifactsPage: React.FC<ArtifactsPageProps> = ({
  initialArtifactId,
  onNavigate,
}) => {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialArtifactId ?? null);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [contentText, setContentText] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string>("");
  const [filterKind, setFilterKind] = useState<string>("");

  const fetchArtifacts = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterSource) params.set("source", filterSource);
    if (filterKind) params.set("kind", filterKind);
    const qs = params.toString();
    const url = `${EMPTYOS_API}/artifacts${qs ? `?${qs}` : ""}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      setArtifacts(Array.isArray(data) ? data : []);
    } catch {
      setArtifacts([]);
    }
  }, [filterSource, filterKind]);

  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts]);

  const fetchArtifactDetail = useCallback(async (id: string) => {
    try {
      const encodedId = id.replace(/:/g, "/");
      const metaRes = await fetch(`${EMPTYOS_API}/artifacts/${encodedId}`);
      if (!metaRes.ok) return;
      const meta: Artifact = await metaRes.json();
      setSelectedArtifact(meta);

      if (meta.mimeType.startsWith("text/") || meta.mimeType === "application/json") {
        const contentRes = await fetch(`${EMPTYOS_API}/artifacts/${encodedId}/content`);
        if (contentRes.ok) {
          setContentText(await contentRes.text());
          setContentUrl(null);
        }
      } else if (meta.mimeType.startsWith("image/")) {
        setContentUrl(`${EMPTYOS_API}/artifacts/${encodedId}/content`);
        setContentText(null);
      } else {
        setContentUrl(`${EMPTYOS_API}/artifacts/${encodedId}/content`);
        setContentText(null);
      }
    } catch {
      setSelectedArtifact(null);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchArtifactDetail(selectedId);
    } else {
      setSelectedArtifact(null);
      setContentText(null);
      setContentUrl(null);
    }
  }, [selectedId, fetchArtifactDetail]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    onNavigate({ page: "artifacts", artifactId: id });
  };

  const sources = [...new Set(artifacts.map((a) => a.source))];
  const kinds = [...new Set(artifacts.map((a) => a.kind))];

  return (
    <div className="artifacts-page">
      <div className="artifacts-sidebar">
        <div className="artifacts-sidebar-header">
          <h2 className="artifacts-sidebar-title">Artifacts</h2>
        </div>

        <div className="artifacts-filters">
          <select
            className="artifacts-filter-select"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="artifacts-filter-select"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
          >
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div className="artifacts-list">
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`artifacts-list-item ${selectedId === a.id ? "active" : ""}`}
              onClick={() => handleSelect(a.id)}
            >
              <div className="artifacts-list-item-header">
                <span className="artifacts-list-item-kind">{a.kind}</span>
                <span className="artifacts-list-item-source">{a.source}</span>
              </div>
              <span className="artifacts-list-item-title">{a.title}</span>
              <span className="artifacts-list-item-date">
                {new Date(a.updatedAt).toLocaleDateString()}
              </span>
            </button>
          ))}
          {artifacts.length === 0 && (
            <div className="artifacts-empty">
              <p>No artifacts found.</p>
            </div>
          )}
        </div>
      </div>

      <div className="artifacts-detail">
        {selectedArtifact ? (
          <>
            <div className="artifacts-detail-header">
              <h2 className="artifacts-detail-title">{selectedArtifact.title}</h2>
              <div className="artifacts-detail-meta">
                <span className="artifacts-detail-badge">{selectedArtifact.kind}</span>
                <span className="artifacts-detail-badge">{selectedArtifact.source}</span>
                <span className="artifacts-detail-date">
                  Updated {new Date(selectedArtifact.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {selectedArtifact.description && (
                <p className="artifacts-detail-desc">{selectedArtifact.description}</p>
              )}
              {selectedArtifact.tags && selectedArtifact.tags.length > 0 && (
                <div className="artifacts-detail-tags">
                  {selectedArtifact.tags.map((tag) => (
                    <span key={tag} className="artifacts-detail-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="artifacts-detail-content">
              {contentText !== null ? (
                <div className="artifacts-content-text">
                  <pre>{contentText}</pre>
                </div>
              ) : contentUrl && selectedArtifact.mimeType.startsWith("image/") ? (
                <div className="artifacts-content-image">
                  <img src={contentUrl} alt={selectedArtifact.title} />
                </div>
              ) : contentUrl && selectedArtifact.mimeType === "application/pdf" ? (
                <div className="artifacts-content-pdf">
                  <iframe src={contentUrl} title={selectedArtifact.title} />
                </div>
              ) : contentUrl ? (
                <div className="artifacts-content-download">
                  <a href={contentUrl} download className="btn-primary">
                    Download ({selectedArtifact.mimeType})
                  </a>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="artifacts-detail-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "hsl(var(--text-tertiary))" }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <p>Select an artifact to view its details.</p>
          </div>
        )}
      </div>
    </div>
  );
};
