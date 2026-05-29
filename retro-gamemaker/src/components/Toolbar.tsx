import React from 'react';

export interface ToolDef {
  id: string;
  label: string;
  icon: string;
}

const DEFAULT_TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select (V)', icon: '⬚' },
  { id: 'pencil', label: 'Pencil (P)', icon: '✎' },
  { id: 'eraser', label: 'Eraser (E)', icon: '✕' },
  { id: 'fill', label: 'Fill (G)', icon: '▣' },
  { id: 'rect', label: 'Rectangle (R)', icon: '▬' },
  { id: 'picker', label: 'Color Picker (I)', icon: '◉' },
];

interface ToolbarProps {
  activeTool?: string;
  onToolSelect?: (toolId: string) => void;
  tools?: ToolDef[];
  children?: React.ReactNode;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool = 'pencil',
  onToolSelect,
  tools = DEFAULT_TOOLS,
  children,
}) => {
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {children}
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={`toolbar-btn ${tool.id === activeTool ? 'active' : ''}`}
          onClick={() => onToolSelect?.(tool.id)}
          title={tool.label}
          aria-label={tool.label}
          aria-pressed={tool.id === activeTool}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
};
