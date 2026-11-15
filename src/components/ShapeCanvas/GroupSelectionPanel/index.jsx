import React, { useRef } from 'react';
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

// Used only on this panel's very first-ever render, before panelRef has
// anything real to measure (see below) - rough enough that the one frame
// it's wrong for isn't noticeable, self-corrects on the next render.
const FALLBACK_PANEL_WIDTH = 220;
const FALLBACK_PANEL_HEIGHT = 36;

/*
  Floating panel for bulk-recoloring (and therefore bulk-reassigning the
  instrument of) every shape in the current group selection at once - e.g.
  the whole composition a trace just produced. Positioned the same way as
  ReferenceImage's action panel (Portal to document.body + #holder offset).

  topLeft (ShapeCanvas/Component.jsx) is the selection's own content
  position converted to screen pixels via the current stageScale/stagePos -
  correct once those have actually committed, but there's a real window
  where it isn't: handleWheel's live zoom preview (ShapeCanvas/
  Container.jsx) updates the canvas's VISUAL scale immediately via a CSS
  transform, while the real stageScale/stagePos commit (and so this
  panel's own position) lags up to 150ms behind. Scrolling continuously
  keeps re-arming that delay, so during a sustained zoom the raw anchor
  point can walk well outside the canvas entirely before it ever gets a
  chance to settle. Clamping to the canvas's own visible area (#holder's
  rect) below means that no longer matters - the panel simply can't go
  further than flush with whichever edge it's heading for, with the
  top-left corner (right where FileNameBadge sits) as the most extreme
  position in that direction.
*/
function GroupSelectionPanel(props) {
  const { topLeft, count, activeColorIndices, onSelectColor, onClose } = props;
  const panelRef = useRef();

  const holderEl = document.getElementById('holder');
  const holderRect = holderEl
    ? holderEl.getBoundingClientRect()
    : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };

  // panelRef.current is only unset on this panel's very first mount (a
  // ref from the previous render is already available by the second) -
  // measuring the real rendered size once it exists gives an exact clamp
  // instead of a guessed one.
  const panelWidth = panelRef.current ? panelRef.current.offsetWidth : FALLBACK_PANEL_WIDTH;
  const panelHeight = panelRef.current ? panelRef.current.offsetHeight : FALLBACK_PANEL_HEIGHT;

  const rawTop = holderRect.top + topLeft.y - 36;
  const rawLeft = holderRect.left + topLeft.x;

  const minTop = holderRect.top;
  const maxTop = Math.max(minTop, holderRect.bottom - panelHeight);
  const minLeft = holderRect.left;
  const maxLeft = Math.max(minLeft, holderRect.right - panelWidth);

  const panelTop = Math.min(Math.max(rawTop, minTop), maxTop);
  const panelLeft = Math.min(Math.max(rawLeft, minLeft), maxLeft);

  return (
    <Portal isOpened>
      <div
        ref={panelRef}
        className={styles.actionPanel}
        style={{ top: panelTop, left: panelLeft }}
      >
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
