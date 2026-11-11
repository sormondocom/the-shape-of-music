import React, { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import Portal from 'react-portal';

import { themeColors } from 'utils/color';
import styles from './styles.module.css';

const propTypes = {
  colorIndex: PropTypes.number.isRequired,
  activeColorIndices: PropTypes.arrayOf(PropTypes.number).isRequired,
  onChange: PropTypes.func.isRequired,
};

/*
  Lets this instrument claim a *different* one of the 16 palette colors -
  any shapes already drawn in its current color move with it
  (ShapeCanvas/Container.jsx's recolorAllShapesWithColor, via
  Project/index.jsx's reassignInstrumentColor). Only currently-inactive
  colors are offered as targets - swapping with another active instrument
  would need a double-swap, out of scope for now (see the plan/session
  notes). Portal-rendered, same proven pattern as InstrumentPicker.
*/
function ColorSwatchPicker({ colorIndex, activeColorIndices, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const wrapperRef = useRef();

  const handleOpen = () => {
    const rect = wrapperRef.current.getBoundingClientRect();
    setPosition({ top: rect.top, left: rect.left });
    setIsOpen(true);
  };

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
      <button
        className={styles.trigger}
        style={{ backgroundColor: themeColors[colorIndex] }}
        title="Change this instrument's color"
        onClick={handleOpen}
      />
      {isOpen && (
        <Portal isOpened>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div
            className={styles.panel}
            style={{ top: position.top, left: position.left, transform: 'translateY(-100%)' }}
          >
            {themeColors.map((hex, i) => {
              const isCurrent = i === colorIndex;
              const isTaken = activeColorIndices.includes(i) && !isCurrent;
              return (
                <button
                  key={hex}
                  className={cx(styles.swatch, isCurrent && styles.swatchCurrent)}
                  style={{ backgroundColor: hex }}
                  disabled={isTaken}
                  title={isTaken ? 'Already used by another instrument' : hex}
                  onClick={() => {
                    if (isCurrent) {
                      setIsOpen(false);
                      return;
                    }
                    onChange(i);
                    setIsOpen(false);
                  }}
                />
              );
            })}
          </div>
        </Portal>
      )}
    </div>
  );
}

ColorSwatchPicker.propTypes = propTypes;

export default ColorSwatchPicker;
