import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';

import styles from './styles.module.css';

const propTypes = {
  isDarkMode: PropTypes.bool,
  onPanUp: PropTypes.func.isRequired,
  onPanDown: PropTypes.func.isRequired,
  onPanLeft: PropTypes.func.isRequired,
  onPanRight: PropTypes.func.isRequired,
  onZoomIn: PropTypes.func.isRequired,
  onZoomOut: PropTypes.func.isRequired,
  // The zoom percentage/level badge (ShapeCanvas/Component.jsx's own
  // zoomBadgeRef'd div) - rendered as a child here, between the +/-
  // buttons, rather than this component owning that DOM node itself.
  // handleWheel mutates that div's textContent/style directly (imperative,
  // not React state - see its own comment) while a wheel gesture is live,
  // so the exact element has to keep existing and keep its ref from
  // mount to unmount; threading it through as children keeps that
  // mechanism untouched while still letting this component own the
  // surrounding button layout.
  children: PropTypes.node,
};

function ControlButton({ title, onClick, children }) {
  return (
    <button type="button" className={styles.button} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

ControlButton.propTypes = {
  title: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

/*
  Bottom-right on-screen pan/zoom cluster - a click-target equivalent of
  WASD/arrows (pan) and Z/Q (zoom), for anyone not using the keyboard
  shortcuts (or who doesn't know about them yet). Reuses the exact same
  ShapeCanvas/Container.jsx methods those keys already call
  (panByKeyboard/zoomByStep via Component.jsx's onPanByStep/onZoomByStep
  props) - a button click is just a single discrete step through the same
  path, not a separate implementation to keep in sync.
*/
function ZoomPanControls({
  isDarkMode,
  onPanUp,
  onPanDown,
  onPanLeft,
  onPanRight,
  onZoomIn,
  onZoomOut,
  children,
}) {
  return (
    <div className={cx(styles.cluster, isDarkMode && styles.dark)}>
      <div className={styles.dpad}>
        <span />
        <ControlButton title="Pan up (W / ↑)" onClick={onPanUp}>
          ▲
        </ControlButton>
        <span />
        <ControlButton title="Pan left (A / ←)" onClick={onPanLeft}>
          ◀
        </ControlButton>
        <span />
        <ControlButton title="Pan right (D / →)" onClick={onPanRight}>
          ▶
        </ControlButton>
        <span />
        <ControlButton title="Pan down (S / ↓)" onClick={onPanDown}>
          ▼
        </ControlButton>
        <span />
      </div>
      <div className={styles.zoomRow}>
        <ControlButton title="Zoom out (Q)" onClick={onZoomOut}>
          −
        </ControlButton>
        {children}
        <ControlButton title="Zoom in (Z)" onClick={onZoomIn}>
          +
        </ControlButton>
      </div>
    </div>
  );
}

ZoomPanControls.propTypes = propTypes;

export default ZoomPanControls;
