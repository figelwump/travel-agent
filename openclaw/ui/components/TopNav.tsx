import React from "react";
import type { AppPage } from "../hooks/useAppRouter";

type TopNavProps = {
  currentPage: string;
  connected: boolean;
  onNavigate: (route: AppPage) => void;
};

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const CompassIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const navItems: { page: string; label: string; Icon: React.FC; route: AppPage }[] = [
  { page: "home", label: "Home", Icon: HomeIcon, route: { page: "home" } },
  { page: "travel", label: "Travel", Icon: CompassIcon, route: { page: "travel" } },
  { page: "artifacts", label: "Artifacts", Icon: FolderIcon, route: { page: "artifacts" } },
  { page: "chat", label: "Chat", Icon: ChatIcon, route: { page: "chat" } },
];

export const TopNav: React.FC<TopNavProps> = ({ currentPage, connected, onNavigate }) => {
  return (
    <nav className="top-nav">
      <div className="top-nav-brand">
        <div className="top-nav-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "hsl(var(--text-inverse))" }}>
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
        </div>
        <span className="top-nav-title">EmptyOS</span>
      </div>

      <div className="top-nav-links">
        {navItems.map(({ page, label, Icon, route }) => (
          <button
            key={page}
            type="button"
            className={`top-nav-link ${currentPage === page ? "active" : ""}`}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(route);
            }}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="top-nav-status">
        <div className={`status-dot ${connected ? "connected" : "disconnected"}`} />
        <span className="text-xs" style={{ color: "hsl(var(--text-tertiary))" }}>
          {connected ? "Connected" : "Connecting..."}
        </span>
      </div>
    </nav>
  );
};
