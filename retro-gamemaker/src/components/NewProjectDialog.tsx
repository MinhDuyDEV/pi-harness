/**
 * NewProjectDialog — modal for creating a new blank project.
 */

import React, { useState, useEffect, useRef } from 'react';

interface NewProjectDialogProps {
  open: boolean;
  onConfirm: (name: string, author: string) => void;
  onCancel: () => void;
}

export const NewProjectDialog: React.FC<NewProjectDialogProps> = ({
  open,
  onConfirm,
  onCancel,
}) => {
  const [name, setName] = useState('Untitled');
  const [author, setAuthor] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('Untitled');
      setAuthor('');
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && name.trim()) onConfirm(name.trim(), author.trim());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, name, author, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">New Project</h2>

        <div className="dialog-field">
          <label className="dialog-label" htmlFor="new-proj-name">Project Name</label>
          <input
            id="new-proj-name"
            ref={nameRef}
            className="dialog-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Game"
          />
        </div>

        <div className="dialog-field">
          <label className="dialog-label" htmlFor="new-proj-author">Author (optional)</label>
          <input
            id="new-proj-author"
            className="dialog-input"
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel}>Cancel</button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={() => onConfirm(name.trim(), author.trim())}
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
