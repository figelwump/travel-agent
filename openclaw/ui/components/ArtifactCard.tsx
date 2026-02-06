import React from "react";

type ArtifactCardProps = {
  title: string;
  kind: string;
  source: string;
  updatedAt: string;
  onClick: () => void;
};

export const ArtifactCard: React.FC<ArtifactCardProps> = ({
  title,
  kind,
  source,
  updatedAt,
  onClick,
}) => {
  return (
    <button type="button" className="artifact-card" onClick={onClick}>
      <div className="artifact-card-header">
        <span className="artifact-card-kind">{kind}</span>
        <span className="artifact-card-source">{source}</span>
      </div>
      <h3 className="artifact-card-title">{title}</h3>
      <span className="artifact-card-date">
        {new Date(updatedAt).toLocaleDateString()}
      </span>
    </button>
  );
};
