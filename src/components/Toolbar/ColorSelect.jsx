import React, { useState, useRef } from 'react';
import Portal from 'react-portal';
import Button from 'components/Button';
import ColorPicker from 'components/ColorPicker';
import styles from './styles.module.css';
import { PROJECT_ACTIONS } from 'utils/project';
import { themeColors } from 'utils/color';
import { useProjectContext } from 'context/useProjectContext';

/*
  The dropdown is rendered through a Portal straight to document.body (same
  technique already proven for ReferenceImage's action panel, the group
  selection panel, and the Layers panel's context menu) so it's guaranteed to
  paint above the canvas and every docked panel, rather than depending on
  fragile z-index/stacking-context interactions with the rest of the toolbar.
*/
function ColorSelect() {
  const { activeColorIndex, activeColorIndices, dispatch } = useProjectContext();
  const [isColorPickerOpen, setColorPickerOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const closeTimer = useRef(null);
  const wrapperRef = useRef(null);
  const activeColor = themeColors[activeColorIndex];

  const handleColorPickerMouseEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setPickerPosition({ top: rect.bottom, left: rect.left });
    }
    setColorPickerOpen(true);
  };

  const handleColorPickerMouseLeave = () => {
    closeTimer.current = setTimeout(() => setColorPickerOpen(false), 150);
  };

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleColorPickerMouseEnter}
      onMouseLeave={handleColorPickerMouseLeave}
      style={{ position: 'relative' }}
    >
      <Button hasBorder color={activeColor} />
      {isColorPickerOpen && (
        <Portal isOpened>
          <div
            className={styles.colorPickerWrapper}
            style={{ top: pickerPosition.top, left: pickerPosition.left }}
            onMouseEnter={handleColorPickerMouseEnter}
            onMouseLeave={handleColorPickerMouseLeave}
          >
            <ColorPicker
              color={activeColor}
              activeColorIndex={activeColorIndex}
              activeColorIndices={activeColorIndices}
              onChange={({ hex }) => {
                dispatch({ type: PROJECT_ACTIONS.SET_DRAW_COLOR, payload: hex });
              }}
            />
          </div>
        </Portal>
      )}
    </div>
  );
}

export default ColorSelect;
