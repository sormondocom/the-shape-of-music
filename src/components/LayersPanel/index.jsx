import React, { useState } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';

import { themeColors } from 'utils/color';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { useMeasuredHeight } from 'utils/useMeasuredHeight';
import LayerRow from './LayerRow';
import RowButton from './RowButton';
import styles from './styles.module.css';

const propTypes = {
  shapesList: PropTypes.array.isRequired,
  deletedShapeIndeces: PropTypes.array.isRequired,
  selectedShapeIndex: PropTypes.number.isRequired,
  selectedShapeIndices: PropTypes.instanceOf(Set).isRequired,
  soloedShapeIndices: PropTypes.instanceOf(Set).isRequired,
  referenceImages: PropTypes.array.isRequired,
  selectedReferenceImageId: PropTypes.string,
  referenceGeoLayers: PropTypes.array.isRequired,
  selectedReferenceGeoLayerId: PropTypes.string,
  onShapeClick: PropTypes.func.isRequired,
  onMuteChange: PropTypes.func.isRequired,
  onVisibilityChange: PropTypes.func.isRequired,
  onSoloChange: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onDeleteSelected: PropTypes.func.isRequired,
  onSelectAll: PropTypes.func.isRequired,
  onClearSelection: PropTypes.func.isRequired,
  onPlayAlone: PropTypes.func.isRequired,
  onAddToSolo: PropTypes.func.isRequired,
  onPlayAll: PropTypes.func.isRequired,
  onSelectReferenceImage: PropTypes.func.isRequired,
  onDeleteReferenceImage: PropTypes.func.isRequired,
  onSelectReferenceGeoLayer: PropTypes.func.isRequired,
  onDeleteReferenceGeoLayer: PropTypes.func.isRequired,
  onRenameReferenceGeoLayer: PropTypes.func.isRequired,
  onCenterReferenceGeoLayer: PropTypes.func.isRequired,
  onToggleReferenceGeoLayerVisibility: PropTypes.func.isRequired,
  onOpenSheetPreview: PropTypes.func.isRequired,
  onPreviewShapeSheet: PropTypes.func.isRequired,
  onNameChange: PropTypes.func.isRequired,
};

/*
  GIMP-style docked layers list - every shape already *is* a "layer"
  (shapesList is the source of truth); this is just a scannable view over it
  with the same select/mute/solo/delete handlers shapes already use on canvas.
  Reference images and reference geo layers show as their own distinct,
  non-musical rows above the shapes - no color/mute/solo, since those are
  shape-only concepts. All three row types share LayerRow/RowButton (this
  folder) for the row shell, rename-in-place, and action buttons, rather
  than three copies of the same markup with slightly different details.
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
    referenceGeoLayers,
    selectedReferenceGeoLayerId,
    onShapeClick,
    onMuteChange,
    onVisibilityChange,
    onSoloChange,
    onDelete,
    onDeleteSelected,
    onSelectAll,
    onClearSelection,
    onPlayAlone,
    onAddToSolo,
    onPlayAll,
    onSelectReferenceImage,
    onDeleteReferenceImage,
    onSelectReferenceGeoLayer,
    onDeleteReferenceGeoLayer,
    onRenameReferenceGeoLayer,
    onCenterReferenceGeoLayer,
    onToggleReferenceGeoLayerVisibility,
    onOpenSheetPreview,
    onPreviewShapeSheet,
    onNameChange,
  } = props;

  // { x, y, items: [{ label, onClick }] } | null - every row type builds
  // its own items array (it already has everything in scope to do so),
  // so this renderer never needs to know what kind of row was
  // right-clicked.
  const [contextMenu, setContextMenu] = useState(null);
  const openContextMenu = (e, items) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  // One rename state for every row type, not one per type - a target is
  // { kind: 'shape', index } or { kind: 'referenceGeoLayer', id }; only
  // one row is ever being renamed at a time, so a single slot is enough.
  // (Reference images have no rename at all right now - LayerRow's
  // onStartRename is simply omitted for that row.)
  const [renameTarget, setRenameTarget] = useState(null);
  const [draftName, setDraftName] = useState('');

  const startRenaming = (target, currentName) => {
    setRenameTarget(target);
    setDraftName(currentName || '');
  };
  const cancelRenaming = () => setRenameTarget(null);
  const commitRenaming = () => {
    const target = renameTarget;
    if (!target) return;
    const trimmed = draftName.trim();
    setRenameTarget(null);
    if (target.kind === 'shape') {
      onNameChange(target.index)(trimmed);
    } else if (target.kind === 'referenceGeoLayer') {
      onRenameReferenceGeoLayer(target.id)(trimmed);
    }
  };
  const isRenamingShape = index =>
    !!renameTarget && renameTarget.kind === 'shape' && renameTarget.index === index;
  const isRenamingGeoLayer = id =>
    !!renameTarget && renameTarget.kind === 'referenceGeoLayer' && renameTarget.id === id;

  const { isDarkMode } = useColorThemeContext();
  const colorControllerPanelHeight = useMeasuredHeight('colorControllerPanel');

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
        {visibleShapes.length === 0 &&
          referenceImages.length === 0 &&
          referenceGeoLayers.length === 0 && (
            <div className={styles.empty}>
              Draw, insert, or trace a shape to see it here.
            </div>
          )}

        {referenceGeoLayers.map(layer => {
          const isSelected = layer.id === selectedReferenceGeoLayerId;
          const isVisible = layer.isVisible !== false;
          return (
            <LayerRow
              key={layer.id}
              isSelected={isSelected}
              isHidden={!isVisible}
              onClick={() => onSelectReferenceGeoLayer(isSelected ? null : layer.id)}
              onContextMenu={e =>
                openContextMenu(e, [
                  {
                    label: 'Rename',
                    onClick: () =>
                      startRenaming(
                        { kind: 'referenceGeoLayer', id: layer.id },
                        layer.sourceLabel
                      ),
                  },
                  { label: 'Center', onClick: () => onCenterReferenceGeoLayer(layer.id) },
                  {
                    label: isVisible ? 'Hide' : 'Show',
                    onClick: () => onToggleReferenceGeoLayerVisibility(layer.id),
                  },
                  { label: 'Delete', onClick: () => onDeleteReferenceGeoLayer(layer.id) },
                ])
              }
              icon={<span className={styles.referenceIcon}>🗺</span>}
              label={`${layer.sourceLabel || 'Reference layer'} (${layer.tracks.length.toLocaleString()} shape${
                layer.tracks.length === 1 ? '' : 's'
              })`}
              isEditing={isRenamingGeoLayer(layer.id)}
              draftValue={draftName}
              onDraftChange={setDraftName}
              onStartRename={() => startRenaming({ kind: 'referenceGeoLayer', id: layer.id }, layer.sourceLabel)}
              onCommitRename={commitRenaming}
              onCancelRename={cancelRenaming}
            >
              <RowButton
                title={isVisible ? 'Hide' : 'Show'}
                isActive={isVisible}
                onClick={() => onToggleReferenceGeoLayerVisibility(layer.id)}
              >
                👁
              </RowButton>
              <RowButton title="Delete" onClick={() => onDeleteReferenceGeoLayer(layer.id)}>
                ✕
              </RowButton>
            </LayerRow>
          );
        })}

        {referenceImages.map((img, i) => {
          const isSelected = img.id === selectedReferenceImageId;
          return (
            <LayerRow
              key={img.id}
              isSelected={isSelected}
              onClick={() => onSelectReferenceImage(isSelected ? null : img.id)}
              onContextMenu={e =>
                openContextMenu(e, [
                  {
                    label: 'Delete Reference Image',
                    onClick: () => onDeleteReferenceImage(img.id),
                  },
                ])
              }
              icon={<span className={styles.referenceIcon}>🖼</span>}
              label={`Reference ${i + 1}`}
            >
              <RowButton title="Delete" onClick={() => onDeleteReferenceImage(img.id)}>
                ✕
              </RowButton>
            </LayerRow>
          );
        })}

        {visibleShapes.map(({ shape, index }) => {
          const isSelected =
            index === selectedShapeIndex || selectedShapeIndices.has(index);
          const isSoloed = soloedShapeIndices.has(index);
          const isVisible = shape.isVisible !== false;
          return (
            <LayerRow
              key={index}
              isSelected={isSelected}
              isHidden={!isVisible}
              onClick={e => onShapeClick(index, shape.points, e.shiftKey)}
              onContextMenu={e =>
                openContextMenu(e, [
                  {
                    label: 'Rename',
                    onClick: () => startRenaming({ kind: 'shape', index }, shape.name),
                  },
                  {
                    label: 'Play Alone',
                    onClick: () => onPlayAlone(getContextMenuTargets(index)),
                  },
                  {
                    label: 'Add to Solo',
                    onClick: () => onAddToSolo(getContextMenuTargets(index)),
                  },
                  { label: 'Play All', onClick: () => onPlayAll() },
                  {
                    label: 'Delete',
                    onClick: () => onDeleteSelected(getContextMenuTargets(index)),
                  },
                ])
              }
              icon={
                <span
                  className={styles.swatch}
                  style={{ background: themeColors[shape.colorIndex] }}
                />
              }
              label={shape.name || `Layer ${index + 1}`}
              isEditing={isRenamingShape(index)}
              draftValue={draftName}
              onDraftChange={setDraftName}
              onStartRename={() => startRenaming({ kind: 'shape', index }, shape.name)}
              onCommitRename={commitRenaming}
              onCancelRename={cancelRenaming}
            >
              <RowButton
                title={isVisible ? 'Hide (also silences it)' : 'Show'}
                isActive={isVisible}
                onClick={onVisibilityChange(index)}
              >
                👁
              </RowButton>
              <RowButton title="Preview as sheet music" onClick={() => onPreviewShapeSheet(index)}>
                🎼
              </RowButton>
              <RowButton title="Mute" isActive={shape.isMuted} onClick={onMuteChange(index)}>
                M
              </RowButton>
              <RowButton title="Solo" isActive={isSoloed} onClick={() => onSoloChange(index)}>
                S
              </RowButton>
              <RowButton title="Delete" onClick={() => onDelete(index)}>
                ✕
              </RowButton>
            </LayerRow>
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
            {contextMenu.items.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  item.onClick();
                  setContextMenu(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

LayersPanel.propTypes = propTypes;

export default LayersPanel;
