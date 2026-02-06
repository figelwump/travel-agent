import React, { useEffect, useState } from "react";
import { AgentCard } from "../components/AgentCard";
import { ArtifactCard } from "../components/ArtifactCard";
import type { AppPage } from "../hooks/useAppRouter";

const EMPTYOS_API = "/agents/travel/api";

type Agent = {
  id: string;
  name: string;
  description: string;
  color?: string;
};

type ArtifactSummary = {
  id: string;
  source: string;
  kind: string;
  title: string;
  updatedAt: string;
};

type HomePageProps = {
  onNavigate: (route: AppPage) => void;
};

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);

  useEffect(() => {
    fetch(`${EMPTYOS_API}/agents`)
      .then((res) => res.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});

    fetch(`${EMPTYOS_API}/artifacts?limit=5`)
      .then((res) => res.json())
      .then((data) => setArtifacts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  return (
    <div className="home-page">
      <div className="home-page-content">
        <div className="home-hero animate-fade-in">
          <h1 className="home-title">EmptyOS</h1>
          <p className="home-subtitle">Your agents, artifacts, and conversations in one place.</p>
        </div>

        <section className="home-section animate-slide-up">
          <h2 className="home-section-title">Agents</h2>
          <div className="home-agents-grid">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                name={agent.name}
                description={agent.description}
                color={agent.color}
                onClick={() => {
                  if (agent.id === "travel") {
                    onNavigate({ page: "travel" });
                  }
                }}
              />
            ))}
            {agents.length === 0 && (
              <AgentCard
                name="Travel Agent"
                description="Plan trips, build itineraries, and research destinations."
                onClick={() => onNavigate({ page: "travel" })}
              />
            )}
          </div>
        </section>

        <section className="home-section animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="home-section-header">
            <h2 className="home-section-title">Recent Artifacts</h2>
            <button
              type="button"
              className="home-section-link"
              onClick={() => onNavigate({ page: "artifacts" })}
            >
              View all
            </button>
          </div>
          {artifacts.length > 0 ? (
            <div className="home-artifacts-grid">
              {artifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  title={artifact.title}
                  kind={artifact.kind}
                  source={artifact.source}
                  updatedAt={artifact.updatedAt}
                  onClick={() => onNavigate({ page: "artifacts", artifactId: artifact.id })}
                />
              ))}
            </div>
          ) : (
            <p className="home-empty-text">
              No artifacts yet. Start a conversation or create a trip to generate artifacts.
            </p>
          )}
        </section>

        <section className="home-section animate-slide-up" style={{ animationDelay: "200ms" }}>
          <h2 className="home-section-title">Quick Actions</h2>
          <div className="home-actions">
            <button
              type="button"
              className="home-action-btn"
              onClick={() => onNavigate({ page: "travel" })}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
              Plan a Trip
            </button>
            <button
              type="button"
              className="home-action-btn"
              onClick={() => onNavigate({ page: "chat" })}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Open Chat
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
