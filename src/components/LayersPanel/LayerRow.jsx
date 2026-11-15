import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';

import styles from './styles.module.css';

const propTypes = {
  isSelected: PropTypes.bool,
  isHidden: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  onContextMenu: PropTypes.func,
  icon: PropTypes.node.isRequired,
  label: PropTypes.string.isRequired,
  isEditing: PropTypes.bool,
  draftValue: PropTypes.string,
  onDraftChange: PropTypes.func,
  onStartRename: PropTypes.func,
  onCommitRename: PropTypes.func,
  onCancelRename: PropTypes.func,
  // right-side action buttons - a row-type-specific set of RowButtons
  children: PropTypes.node,
};

/*
  The shared shell every LayersPanel row (a shape, the reference image,
  a reference geo layer) is built from: the selectable/hidden-dimmed row
  itself, an icon slot (a color swatch, an emoji - whatever that row type
  uses), a label that becomes an inline rename input on double-click, and
  a slot for whatever action buttons that row type actually has (a shape
  gets visibility/preview/mute/solo/delete; a reference geo layer gets
  visibility/delete; a reference image gets just delete).

  Rename is opt-in: pass onStartRename to make the label double-click-
  renamable (isEditing/draftValue/onDraftChange/onCommitRename/
  onCancelRename then all need to come from the caller's own rename
  state); omit it and the label is just static text - the reference
  image row currently has no rename at all, same as before this existed.
*/
function LayerRow({
  isSelected,
  isHidden,
  onClick,
  onContextMenu,
  icon,
  label,
  isEditing,
  draftValue,
  onDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  children,
}) {
  return (
    <div
      className={cx(styles.row, {
        [styles.rowSelected]: isSelected,
        [styles.rowHidden]: isHidden,
      })}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {icon}
      {isEditing ? (
        <input
          className={styles.labelInput}
          value={draftValue}
          autoFocus
          onClick={e => e.stopPropagation()}
          onChange={e => onDraftChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelRename();
            }
          }}
        />
      ) : (
        <span
          className={styles.label}
          title={onStartRename ? 'Double-click to rename' : label}
          onDoubleClick={
            onStartRename
              ? e => {
                  e.stopPropagation();
                  onStartRename();
                }
              : undefined
          }
        >
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

LayerRow.propTypes = propTypes;

export default LayerRow;
