import React from 'react';
import PropTypes from 'prop-types';
import Portal from 'react-portal';

import { themeColors } from 'utils/color';
import styles from '../ReferenceImage/styles.module.css';

const propTypes = {
  topLeft: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  count: PropTypes.number.isRequired,
  activeColorIndices: PropTypes.arrayOf(PropTypes.number).isRequired,
  onSelectColor: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

/*
  Floating panel for bulk-recoloring (and therefore bulk-reassigning the
  instrument of) every shape in the current group selection at once - e.g.
  the whole composition a trace just produced. Positioned the same way as
  ReferenceImage's action panel (Portal to document.body + #holder offset).
*/
function GroupSelectionPanel(props) {
  const { topLeft, count, activeColorIndices, onSelectColor, onClose } = props;

  const holderEl = document.getElementById('holder');
  const holderRect = holderEl
    ? holderEl.getBoundingClientRect()
    : { top: 0, left: 0 };
  const panelTop = Math.max(0, holderRect.top + topLeft.y - 36);
  const panelLeft = holderRect.left + topLeft.x;

  return (
    <Portal isOpened>
      <div className={styles.actionPanel} style={{ top: panelTop, left: panelLeft }}>
        <span className={styles.selectionLabel}>
          {count} shape{count === 1 ? '' : 's'} selected
        </span>
        {activeColorIndices.map(colorIndex => (
          <button
            key={colorIndex}
            className={styles.colorSwatch}
            style={{ background: themeColors[colorIndex] }}
            title={`Change to this instrument`}
            onClick={() => onSelectColor(colorIndex)}
          />
        ))}
        <button className={styles.actionButton} onClick={onClose}>
          Close
        </button>
      </div>
    </Portal>
  );
}

GroupSelectionPanel.propTypes = propTypes;

export default GroupSelectionPanel;
