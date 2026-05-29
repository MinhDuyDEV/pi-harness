/**
 * EntityInspector — edit properties of a selected entity: position,
 * behaviour parameters, and delete/duplicate controls.
 *
 * Also serves as the entity list panel for selection and reorder.
 */

import React, { useCallback } from 'react';
import { Entity, MAX_ENTITIES } from '../core/Entity';
import { EntityType, EntityProperties } from '../core/EntityType';
import { getBehaviorDef, BehaviorParamDef } from '../core/Behavior';

interface EntityInspectorProps {
  entities: Entity[];
  entityTypes: EntityType[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  onUpdateEntity: (id: string, changes: Partial<Entity>) => void;
  onDeleteEntity: (id: string) => void;
  onDuplicateEntity: (id: string) => void;
  onReorderEntity: (fromIndex: number, toIndex: number) => void;
  tileSize: number;
}

export const EntityInspector: React.FC<EntityInspectorProps> = ({
  entities,
  entityTypes,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntity,
  onDeleteEntity,
  onDuplicateEntity,
  onReorderEntity,
  tileSize,
}) => {
  const selectedEntity = entities.find((e) => e.id === selectedEntityId);
  const selectedType = selectedEntity
    ? entityTypes.find((t) => t.id === selectedEntity.typeId)
    : null;
  const behaviorDef = selectedType
    ? getBehaviorDef(selectedType.behaviorType)
    : null;

  const handlePropChange = useCallback(
    (key: keyof EntityProperties, value: number | string | boolean) => {
      if (!selectedEntity) return;
      onUpdateEntity(selectedEntity.id, {
        properties: { ...selectedEntity.properties, [key]: value },
      });
    },
    [selectedEntity, onUpdateEntity],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      onReorderEntity(index, index - 1);
    },
    [onReorderEntity],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= entities.length - 1) return;
      onReorderEntity(index, index + 1);
    },
    [entities.length, onReorderEntity],
  );

  return (
    <div className="entity-inspector">
      <div className="entity-inspector-header">
        <span>Entities ({entities.length}/{MAX_ENTITIES})</span>
      </div>

      {/* Entity list */}
      <div className="entity-list" role="listbox" aria-label="Entity list">
        {entities.length === 0 && (
          <div className="entity-list-empty">
            No entities placed. Select a type from the palette and click the map.
          </div>
        )}

        {entities.map((entity, idx) => {
          const type = entityTypes.find((t) => t.id === entity.typeId);
          return (
            <div
              key={entity.id}
              className={`entity-list-item ${entity.id === selectedEntityId ? 'active' : ''}`}
              onClick={() => onSelectEntity(entity.id)}
              role="option"
              aria-selected={entity.id === selectedEntityId}
            >
              <span
                className="entity-list-color-dot"
                style={{ backgroundColor: type?.color ?? '#666' }}
              />
              <span className="entity-list-name">
                {type?.name ?? entity.typeId}
              </span>
              <span className="entity-list-coords">
                {entity.x},{entity.y}
              </span>
              <div className="entity-list-actions">
                <button
                  className="layer-btn-xs"
                  onClick={(e) => { e.stopPropagation(); handleMoveUp(idx); }}
                  disabled={idx <= 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="layer-btn-xs"
                  onClick={(e) => { e.stopPropagation(); handleMoveDown(idx); }}
                  disabled={idx >= entities.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="layer-btn-xs danger"
                  onClick={(e) => { e.stopPropagation(); onDeleteEntity(entity.id); }}
                  title="Delete entity"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Entity detail inspector */}
      {selectedEntity && selectedType && (
        <div className="entity-detail">
          <div className="entity-detail-header">
            <span style={{ color: selectedType.color }}>
              {selectedType.name}
            </span>
            <button
              className="palette-btn-sm"
              onClick={() => onDuplicateEntity(selectedEntity.id)}
              title="Duplicate entity"
            >
              ⧉ Dup
            </button>
            <button
              className="palette-btn-sm danger"
              onClick={() => onDeleteEntity(selectedEntity.id)}
              title="Delete entity"
            >
              ✕ Delete
            </button>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Position</div>
            <div className="inspector-field">
              <label>X</label>
              <input
                type="number"
                className="inspector-number-input"
                value={selectedEntity.x}
                onChange={(e) =>
                  onUpdateEntity(selectedEntity.id, { x: Number(e.target.value) })
                }
              />
            </div>
            <div className="inspector-field">
              <label>Y</label>
              <input
                type="number"
                className="inspector-number-input"
                value={selectedEntity.y}
                onChange={(e) =>
                  onUpdateEntity(selectedEntity.id, { y: Number(e.target.value) })
                }
              />
            </div>
            <div className="inspector-field">
              <label>Tile</label>
              <span className="inspector-static-value">
                ({Math.floor(selectedEntity.x / tileSize)}, {Math.floor(selectedEntity.y / tileSize)})
              </span>
            </div>
          </div>

          {/* Behavior params */}
          {behaviorDef && behaviorDef.params.length > 0 && (
            <div className="inspector-section">
              <div className="inspector-section-title">
                Behavior: {behaviorDef.label}
              </div>
              <p className="inspector-description">{behaviorDef.description}</p>
              {behaviorDef.params.map((param) => (
                <div key={param.key} className="inspector-field">
                  <label>{param.label}</label>
                  {renderParamInput(
                    param,
                    selectedEntity.properties[param.key],
                    handlePropChange,
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Param input renderer ─── */

function renderParamInput(
  param: BehaviorParamDef,
  currentValue: unknown,
  onChange: (key: keyof EntityProperties, value: number | string | boolean) => void,
): React.ReactNode {
  const key = param.key;

  switch (param.type) {
    case 'number': {
      const val = typeof currentValue === 'number' ? currentValue : param.min ?? 0;
      return (
        <input
          type="number"
          className="inspector-number-input"
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={val}
          onChange={(e) => onChange(key, parseFloat(e.target.value) || 0)}
        />
      );
    }
    case 'select': {
      const val = typeof currentValue === 'string' ? currentValue : (param.options?.[0] ?? '');
      return (
        <select
          className="inspector-select"
          value={val}
          onChange={(e) => onChange(key, e.target.value)}
        >
          {param.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </option>
          ))}
        </select>
      );
    }
    case 'boolean': {
      const val = typeof currentValue === 'boolean' ? currentValue : false;
      return (
        <input
          type="checkbox"
          className="inspector-checkbox"
          checked={val}
          onChange={(e) => onChange(key, e.target.checked)}
        />
      );
    }
    default:
      return <span className="inspector-static-value">—</span>;
  }
}
