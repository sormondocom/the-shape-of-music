import React from 'react';
import PropTypes from 'prop-types';
import Portal from 'react-portal';

import { themeColors } from 'utils/color';
import SheetStaff from 'components/SheetStaff';
import styles from './styles.module.css';

const propTypes = {
  notationData: PropTypes.arrayOf(
    PropTypes.shape({
      index: PropTypes.number.isRequired,
      colorIndex: PropTypes.number.isRequired,
      noteEvents: PropTypes.array.isRequired,
    })
  ).isRequired,
  filterIndex: PropTypes.number, // null/undefined = show every layer
  isPlaying: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  onShowAll: PropTypes.func,
};

/*
  Read-only "what does this look like in standard notation" preview - see
  components/SheetStaff for the actual VexFlow rendering and utils/
  notation.js for the quantization that makes it possible. The notation
  itself (which notes/measures exist) is a snapshot, not a live mirror:
  notationData is pulled once (when opened, or on Refresh), not re-pulled
  as shapes are edited while this stays open. Which note is highlighted,
  though, IS live while isPlaying - see SheetStaff/utils/playbackCursor.js -
  so the shape can still be followed along in real time without the
  underlying notation itself needing to re-sync.
*/
function SheetPreviewModal({
  notationData,
  filterIndex,
  isPlaying,
  onClose,
  onRefresh,
  onShowAll,
}) {
  const visibleData =
    filterIndex == null ? notationData : notationData.filter(d => d.index === filterIndex);

  return (
    <Portal isOpened>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <span>
            {filterIndex == null ? 'Sheet Preview' : `Sheet Preview — Layer ${filterIndex + 1}`}
          </span>
          <div className={styles.headerActions}>
            {filterIndex != null && onShowAll && (
              <button onClick={onShowAll}>Show all layers</button>
            )}
            <button onClick={onRefresh}>Refresh</button>
            <button onClick={() => window.print()}>Print</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <div className={styles.body}>
          {visibleData.length === 0 && (
            <div className={styles.empty}>No layers to preview yet.</div>
          )}
          {visibleData.map(({ index, colorIndex, noteEvents }) => (
            <div key={index} className={styles.staffRow}>
              <div className={styles.staffLabel}>
                <span
                  className={styles.swatch}
                  style={{ background: themeColors[colorIndex] }}
                />
                Layer {index + 1}
              </div>
              <SheetStaff
                noteEvents={noteEvents}
                color={themeColors[colorIndex]}
                shapeIndex={index}
                isPlaying={isPlaying}
              />
            </div>
          ))}
        </div>
      </div>
    </Portal>
  );
}

SheetPreviewModal.propTypes = propTypes;

export default SheetPreviewModal;
