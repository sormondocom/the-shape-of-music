import React, { useState } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';

import { themeColors } from 'utils/color';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { useMeasuredHeight } from 'utils/useMeasuredHeight';
import styles from './styles.module.css';

const propTypes = {
  shapesList: PropTypes.array.isRequired,
  deletedShapeIndeces: PropTypes.array.isRequired,
  selectedShapeIndex: PropTypes.number.isRequired,
  selectedShapeIndices: PropTypes.instanceOf(Set).isRequired,
  soloedShapeIndices: PropTypes.instanceOf(Set).isRequired,
  referenceImages: PropTypes.array.isRequired,
  selectedReferenceImageId: PropTypes.string,
  onShapeClick: PropTypes.func.isRequired,
  onMuteChange: PropTypes.func.isRequired,
  onVisibilityChange: PropTypes.func.isRequired,
  onSoloChange: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onSelectAll: PropTypes.func.isRequired,
  onClearSelection: PropTypes.func.isRequired,
  onPlayAlone: PropTypes.func.isRequired,
  onAddToSolo: PropTypes.func.isRequired,
  onPlayAll: PropTypes.func.isRequired,
  onSelectReferenceImage: PropTypes.func.isRequired,
  onDeleteReferenceImage: PropTypes.func.isRequired,
  onOpenSheetPreview: PropTypes.func.isRequired,
  onPreviewShapeSheet: PropTypes.func.isRequired,
  onNameChange: PropTypes.func.isRequired,
};

/*
  GIMP-style docked layers list - every shape already *is* a "layer"
  (shapesList is the source of truth); this is just a scannable view over it
  with the same select/mute/solo/delete handlers shapes already use on canvas.
  The reference image (if any) shows as a distinct, non-musical "reference"
  row at the top - no color/mute/solo, since those are shape-only concepts.
*/
function LayersPanel(props) {
  const {
    shapesList,
    deletedShapeIndeces,
    selectedShapeIndex,
    selectedShapeIndices,
    soloedShapeIndices,
    referenceImages,
    selectedReferenceImageId,
    onShapeClick,
    onMuteChange,
    onVisibilityChange,
    onSoloChange,
    onDelete,
    onSelectAll,
    onClearSelection,
    onPlayAlone,
    onAddToSolo,
    onPlayAll,
    onSelectReferenceImage,
    onDeleteReferenceImage,
    onOpenSheetPreview,
    onPreviewShapeSheet,
    onNameChange,
  } = props;

  // { x, y, target: { type: 'shape', index } | { type: 'reference' } } | null
  const [contextMenu, setContextMenu] = useState(null);
  // index currently being renamed (double-click, or the context menu's
  // Rename item) - null means no row is in edit mode. Only one at a time;
  // renaming a group selection at once wouldn't have an obvious single
  // name to show, so this always targets exactly one row.
  const [editingIndex, setEditingIndex] = useState(null);
  const [draftName, setDraftName] = useState('');
  const { isDarkMode } = useColorThemeContext();
  const colorControllerPanelHeight = useMeasuredHeight('colorControllerPanel');

  const startRenaming = (index, currentName) => {
    setEditingIndex(index);
    setDraftName(currentName || '');
  };

  const commitRename = index => {
    onNameChange(index)(draftName.trim());
    setEditingIndex(null);
  };

  const visibleShapes = shapesList
    .map((shape, index) => ({ shape, index }))
    .filter(({ index }) => !deletedShapeIndeces[index]);

  // if the right-clicked row is part of the current multi-select, act on the
  // whole group; otherwise act on just that row
  const getContextMenuTargets = index =>
    selectedShapeIndices.size > 0 && selectedShapeIndices.has(index)
      ? selectedShapeIndices
      : new Set([index]);

  return (
    <div
      className={cx(styles.panel, { [styles.panelDark]: isDarkMode })}
      style={{ bottom: colorControllerPanelHeight }}
    >
      <div className={styles.header}>
        <span>Layers</span>
        <div className={styles.headerActions}>
          <button onClick={onSelectAll}>Select All</button>
          <button onClick={onClearSelection}>Clear</button>
          <button title="Preview every layer as sheet music" onClick={onOpenSheetPreview}>
            Sheet Preview
          </button>
        </div>
      </div>
      <div className={styles.list}>
        {visibleShapes.length === 0 && referenceImages.length === 0 && (
          <div className={styles.empty}>
            Draw, insert, or trace a shape to see it here.
          </div>
        )}

        {referenceImages.map((img, i) => {
          const isSelected = img.id === selectedReferenceImageId;
          return (
            <div
              key={img.id}
              className={cx(styles.row, { [styles.rowSelected]: isSelected })}
              onClick={() =>
                onSelectReferenceImage(isSelected ? null : img.id)
              }
              onContextMenu={e => {
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  target: { type: 'reference', id: img.id },
                });
              }}
            >
              <span className={styles.referenceIcon}>🖼</span>
              <span className={styles.label}>Reference {i + 1}</span>
              <button
                className={styles.rowButton}
                title="Delete"
                onClick={e => {
                  e.stopPropagation();
                  onDeleteReferenceImage(img.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}

        {visibleShapes.map(({ shape, index }) => {
          const isSelected =
            index === selectedShapeIndex || selectedShapeIndices.has(index);
          const isSoloed = soloedShapeIndices.has(index);
          const isVisible = shape.isVisible !== false;
          return (
            <div
              key={index}
              className={cx(styles.row, {
                [styles.rowSelected]: isSelected,
                [styles.rowHidden]: !isVisible,
              })}
              onClick={e => onShapeClick(index, shape.points, e.shiftKey)}
              onContextMenu={e => {
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  target: { type: 'shape', index },
                });
              }}
            >
              <span
                className={styles.swatch}
                style={{ background: themeColors[shape.colorIndex] }}
              />
              {editingIndex === index ? (
                <input
                  className={styles.labelInput}
                  value={draftName}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onChange={e => setDraftName(e.target.value)}
                  onBlur={() => commitRename(index)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(index);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingIndex(null);
                    }
                  }}
                />
              ) : (
                <span
                  className={styles.label}
                  title="Double-click to rename"
                  onDoubleClick={e => {
                    e.stopPropagation();
                    startRenaming(index, shape.name);
                  }}
                >
                  {shape.name || `Layer ${index + 1}`}
                </span>
              )}
              <button
                className={cx(styles.rowButton, {
                  [styles.rowButtonActive]: isVisible,
                })}
                title={isVisible ? 'Hide (also silences it)' : 'Show'}
                onClick={e => {
                  e.stopPropagation();
                  onVisibilityChange(index)();
                }}
              >
                👁
              </button>
              <button
                className={styles.rowButton}
                title="Preview as sheet music"
                onClick={e => {
                  e.stopPropagation();
                  onPreviewShapeSheet(index);
                }}
              >
                🎼
              </button>
              <button
                className={cx(styles.rowButton, {
                  [styles.rowButtonActive]: shape.isMuted,
                })}
                title="Mute"
                onClick={e => {
                  e.stopPropagation();
                  onMuteChange(index)();
                }}
              >
                M
              </button>
              <button
                className={cx(styles.rowButton, {
                  [styles.rowButtonActive]: isSoloed,
                })}
                title="Solo"
                onClick={e => {
                  e.stopPropagation();
                  onSoloChange(index);
                }}
              >
                S
              </button>
              <button
                className={styles.rowButton}
                title="Delete"
                onClick={e => {
                  e.stopPropagation();
                  onDelete(index);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <>
          <div
            className={styles.contextMenuBackdrop}
            onClick={() => setContextMenu(null)}
            onContextMenu={e => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className={cx(styles.contextMenu, {
              [styles.contextMenuDark]: isDarkMode,
            })}
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {contextMenu.target.type === 'reference' ? (
              <button
                onClick={() => {
                  onDeleteReferenceImage(contextMenu.target.id);
                  setContextMenu(null);
                }}
              >
                Delete Reference Image
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    const { index } = contextMenu.target;
                    const shape = shapesList[index];
                    setContextMenu(null);
                    startRenaming(index, shape && shape.name);
                  }}
                >
                  Rename
                </button>
                <button
                  onClick={() => {
                    onPlayAlone(getContextMenuTargets(contextMenu.target.index));
                    setContextMenu(null);
                  }}
                >
                  Play Alone
                </button>
                <button
                  onClick={() => {
                    onAddToSolo(getContextMenuTargets(contextMenu.target.index));
                    setContextMenu(null);
                  }}
                >
                  Add to Solo
                </button>
                <button
                  onClick={() => {
                    onPlayAll();
                    setContextMenu(null);
                  }}
                >
                  Play All
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

LayersPanel.propTypes = propTypes;

export default LayersPanel;
