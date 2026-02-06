import React from "react";

type AgentCardProps = {
  name: string;
  description: string;
  color?: string;
  icon?: React.ReactNode;
  onClick: () => void;
};

export const AgentCard: React.FC<AgentCardProps> = ({
  name,
  description,
  color = "hsl(var(--accent-primary))",
  icon,
  onClick,
}) => {
  return (
    <button type="button" className="agent-card" onClick={onClick}>
      <div className="agent-card-icon" style={{ background: color }}>
        {icon ?? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "hsl(var(--text-inverse))" }}>
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
        )}
      </div>
      <div className="agent-card-content">
        <h3 className="agent-card-name">{name}</h3>
        <p className="agent-card-desc">{description}</p>
      </div>
      <svg className="agent-card-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 4l4 4-4 4" />
      </svg>
    </button>
  );
};
