import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import styles from './styles.module.css';

const propTypes = {
  orientation: PropTypes.oneOf(['horizontal', 'vertical']).isRequired,
  thumbFraction: PropTypes.number.isRequired,
  positionFraction: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  // extra px to push the bar up from its CSS default bottom - the caller
  // measures how much bottom chrome (Color Controller footer, Spectrometer
  // panel) is currently covering the canvas and passes that in, since
  // hardcoding it here would drift out of sync (the footer's height isn't
  // even fixed - it has a collapse feature)
  bottomOffset: PropTypes.number,
};

/*
  A custom (not native overflow:scroll) scrollbar for panning the canvas -
  native scrollbars would fight with the wheel=zoom handler already wired up
  on the Stage, since a wheel event over a scrollable ancestor also tries to
  trigger native scrolling. This is a plain drag-the-thumb / click-the-track
  control that reports a 0-1 fraction back to the caller, which owns the
  actual stagePos math (utils/panScrollbar.js).

  The thumb's size/position are rendered as plain CSS percentages (the
  .track parent always has a definite pixel width/height, so percentages
  "just work" with no measurement) - real pixel measurement is only needed
  inside the drag/click handlers below, to convert a mouse delta into a
  fraction delta.
*/
function PanScrollbar(props) {
  const { orientation, thumbFraction, positionFraction, onChange, bottomOffset } = props;
  const isHorizontal = orientation === 'horizontal';

  const trackRef = useRef();
  const [isDragging, setIsDragging] = useState(false);
  const { isDarkMode } = useColorThemeContext();

  const getTrackLength = () => {
    const rect = trackRef.current.getBoundingClientRect();
    return isHorizontal ? rect.width : rect.height;
  };

  const handleThumbMouseDown = e => {
    e.stopPropagation();
    const length = getTrackLength();
    const startClientPos = isHorizontal ? e.clientX : e.clientY;
    const startFraction = positionFraction;
    const availableRange = Math.max(1, length * (1 - thumbFraction));
    setIsDragging(true);

    const handleMouseMove = moveEvt => {
      const clientPos = isHorizontal ? moveEvt.clientX : moveEvt.clientY;
      const deltaFraction = (clientPos - startClientPos) / availableRange;
      onChange(Math.max(0, Math.min(1, startFraction + deltaFraction)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // clicking the track (not the thumb) jumps the thumb's center there
  const handleTrackMouseDown = e => {
    const rect = trackRef.current.getBoundingClientRect();
    const length = isHorizontal ? rect.width : rect.height;
    const clickPos = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;
    const thumbLengthPx = thumbFraction * length;
    const availableRange = Math.max(1, length - thumbLengthPx);
    const fraction = (clickPos - thumbLengthPx / 2) / availableRange;
    onChange(Math.max(0, Math.min(1, fraction)));
  };

  const thumbLengthPct = `${thumbFraction * 100}%`;
  const thumbOffsetPct = `${positionFraction * (1 - thumbFraction) * 100}%`;
  // add to the CSS class's own base offset (0 horizontal / 12 vertical)
  // rather than replace it, so the vertical bar's corner clearance is kept
  const trackStyle = bottomOffset
    ? { bottom: (isHorizontal ? 0 : 12) + bottomOffset }
    : undefined;

  return (
    <div
      ref={trackRef}
      className={cx(
        styles.track,
        isHorizontal ? styles.horizontal : styles.vertical,
        isDarkMode && styles.dark
      )}
      style={trackStyle}
      onMouseDown={handleTrackMouseDown}
    >
      <div
        className={cx(styles.thumb, isDragging && styles.dragging, isDarkMode && styles.dark)}
        onMouseDown={handleThumbMouseDown}
        style={
          isHorizontal
            ? { left: thumbOffsetPct, width: thumbLengthPct }
            : { top: thumbOffsetPct, height: thumbLengthPct }
        }
      />
    </div>
  );
}

PanScrollbar.propTypes = propTypes;

export default PanScrollbar;
