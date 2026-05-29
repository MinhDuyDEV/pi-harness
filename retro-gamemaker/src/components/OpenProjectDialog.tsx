/**
 * OpenProjectDialog — modal listing saved projects with name, date, and size.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { ProjectSummary, ProjectStore } from '../core/ProjectStore';

interface OpenProjectDialogProps {
  open: boolean;
  onSelect: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onCancel: () => void;
}

export const OpenProjectDialog: React.FC<OpenProjectDialogProps> = ({
  open,
  onSelect,
  onDelete,
  onCancel,
}) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ProjectStore.list();
      setProjects(list);
    } catch {
      setProjects([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  const handleDelete = useCallback(
    (id: string) => {
      if (confirmDelete === id) {
        onDelete(id);
        setConfirmDelete(null);
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } else {
        setConfirmDelete(id);
      }
    },
    [confirmDelete, onDelete],
  );

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">Open Project</h2>

        {loading && <p className="dialog-loading">Loading projects…</p>}

        {!loading && projects.length === 0 && (
          <p className="dialog-empty">No saved projects yet.</p>
        )}

        <div className="project-list">
          {projects.map((proj) => (
            <div
              key={proj.id}
              className="project-list-item"
              onClick={() => onSelect(proj.id)}
            >
              <div className="project-list-thumb">
                {proj.mapWidth > 0 ? (
                  <span className="project-list-size">
                    {proj.mapWidth}×{proj.mapHeight}
                  </span>
                ) : (
                  <span className="project-list-icon">🎮</span>
                )}
              </div>
              <div className="project-list-info">
                <span className="project-list-name">{proj.name}</span>
                <span className="project-list-meta">
                  {proj.author ? `${proj.author} · ` : ''}
                  {formatDate(proj.modifiedAt)}
                </span>
                <span className="project-list-detail">
                  Palette: {proj.paletteSize} colours
                </span>
              </div>
              <button
                className={`project-list-delete ${confirmDelete === proj.id ? 'confirming' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(proj.id);
                }}
                title={confirmDelete === proj.id ? 'Click again to confirm delete' : 'Delete project'}
              >
                {confirmDelete === proj.id ? 'Confirm?' : '✕'}
              </button>
            </div>
          ))}
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
};
