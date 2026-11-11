import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { themeColors, getDarker } from 'utils/color';

import CheckboxButton from 'components/CheckboxButton';
import CustomSlider from 'components/Slider';
import Button from 'components/Button';

import ColorPicker from 'components/ColorPicker';

import styles from './styles.module.css';

const propTypes = {
  panelStyle: PropTypes.shape({
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
    left: PropTypes.number.isRequired,
    top: PropTypes.number.isRequired,
  }),
  colorIndex: PropTypes.number.isRequired,
  activeColorIndex: PropTypes.number.isRequired,
  activeColorIndices: PropTypes.arrayOf(PropTypes.number).isRequired,
  volume: PropTypes.number.isRequired,
  startOffset: PropTypes.number,

  isMuted: PropTypes.bool.isRequired,
  isSoloed: PropTypes.bool.isRequired,

  onColorChange: PropTypes.func.isRequired,
  onVolumeChange: PropTypes.func.isRequired,
  onStartOffsetChange: PropTypes.func.isRequired,
  onMuteChange: PropTypes.func.isRequired,
  onSoloChange: PropTypes.func.isRequired,
  onQuantizeFactorChange: PropTypes.func.isRequired,

  // onQuantizeClick: PropTypes.func.isRequired,
  onToTopClick: PropTypes.func.isRequired,
  onToBottomClick: PropTypes.func.isRequired,
  onDeleteClick: PropTypes.func.isRequired,

  // perimeter: PropTypes.number.isRequired,
};

function ShapeEditorPopoverComponent(props) {
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const {
    volume,
    onVolumeChange,
    startOffset = 0,
    onStartOffsetChange,
    isMuted,
    onMuteChange,
    isSoloed,
    onSoloChange,
    onColorChange,
    onQuantizeFactorChange,
    onReverseClick,
    onToTopClick,
    onToBottomClick,
    onDeleteClick,
    onDuplicateClick,
    colorIndex,
    activeColorIndex,
    activeColorIndices,
    panelStyle: { width, height, top, left },
  } = props;
  const colorString = themeColors[colorIndex];
  const darkColor = getDarker(colorString, 0.2);
  const medColor = getDarker(colorString);

  return (
    <div
      className={styles.ShapeEditorPopover}
      style={{
        width,
        height,
        top,
        left,
        backgroundColor: darkColor,
        fontWeight: 'bold',
      }}
    >
      <div className={styles.sliderContainer}>
        <CustomSlider
          color={colorString}
          min={-18}
          max={0}
          value={volume}
          onChange={onVolumeChange}
        />
      </div>
      <div className={styles.buttonShort}>
        <CheckboxButton
          label="Mute"
          checked={isMuted}
          onChange={onMuteChange}
          color={colorString}
        />
      </div>
      <div className={styles.buttonShort}>
        <CheckboxButton
          label="Solo"
          checked={isSoloed}
          onChange={onSoloChange}
          color={colorString}
        />
      </div>
      <div
        className={styles.colorPickerContainer}
        style={{
          backgroundColor: colorString,
          height: isColorPickerOpen ? 61 : 30,
        }}
      >
        <Button
          color={colorString}
          onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
        >
          Color{' '}
          <i
            className={
              isColorPickerOpen ? 'ion-arrow-up-b' : 'ion-arrow-down-b'
            }
          />
        </Button>
        <ColorPicker
          triangle="hide"
          color={colorString}
          activeColorIndex={activeColorIndex}
          activeColorIndices={activeColorIndices}
          onChange={onColorChange}
        />
      </div>
      {/*<button onClick={onQuantizeClick}>Quantize</button>*/}
      <div className={styles.thirds}>
        <Button color={colorString} onClick={onQuantizeFactorChange(2)}>
          {'*2'}
        </Button>
        <Button color={colorString} onClick={onQuantizeFactorChange(0.5)}>
          {'/2'}
        </Button>
        <Button
          title="Reverse Direction"
          color={colorString}
          onClick={onReverseClick}
        >
          <i className="ion-arrow-swap" />
        </Button>
      </div>
      <Button color={colorString} onClick={onToTopClick}>
        To Front
      </Button>
      <Button color={colorString} onClick={onToBottomClick}>
        To Back
      </Button>
      <Button
        className={styles.duplicateButton}
        color={colorString}
        onClick={onDuplicateClick}
      >
        Duplicate
      </Button>
      <Button
        className={styles.deleteButton}
        color={medColor}
        onClick={onDeleteClick}
      >
        Delete
      </Button>
      <div className={styles.startDelayContainer} style={{ backgroundColor: medColor }}>
        <CustomSlider
          min={0}
          max={20}
          step={0.1}
          color={colorString}
          vertical={false}
          defaultValue={startOffset}
          onChange={onStartOffsetChange}
          label={
            // same uncontrolled-handle / live-label pattern as TempoInput:
            // the handle only reflects drags made on this slider itself,
            // but the number below it tracks startOffset's own value
            // (set elsewhere - e.g. a MIDI import's per-track entrance
            // time - just as readily as a drag here would)
            <div style={{ color: 'initial', lineHeight: 1.1, fontSize: '0.85em' }}>
              <div>Start Delay</div>
              <div style={{ fontSize: '0.85em', opacity: 0.85 }}>
                {startOffset.toFixed(1)}s
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

ShapeEditorPopoverComponent.propTypes = propTypes;

export default ShapeEditorPopoverComponent;
