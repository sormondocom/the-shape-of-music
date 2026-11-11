import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import Knob from 'components/Knob';
import Button from 'components/Button';

import { getDarker } from 'utils/color';
import { previewInstrument } from 'utils/instrumentPreview';
import {
  isSf2Reference,
  getSf2State,
  subscribeSf2Engine,
  SF2_DYNAMIC_PARAMS,
} from 'utils/sf2Engine';
import InstrumentPicker from './InstrumentPicker';
import ColorSwatchPicker from './ColorSwatchPicker';

import styles from './styles.module.css';
import { SYNTH_PRESETS } from 'instrumentPresets';
import { PROJECT_ACTIONS } from 'utils/project';
import { useProjectContext } from 'context/useProjectContext';

const propTypes = {
  color: PropTypes.string.isRequired,
  synthType: PropTypes.string.isRequired,
  knobVals: PropTypes.array.isRequired,
  activeColorIndices: PropTypes.arrayOf(PropTypes.number).isRequired,
  canRemove: PropTypes.bool.isRequired,
  onRemove: PropTypes.func.isRequired,
};

function ColorControllerComponent(props) {
  const {
    synthType,
    color,
    knobVals,
    colorIndex,
    activeColorIndices,
    canRemove,
    onRemove,
  } = props;
  const {
    dispatch,
    imperativeHandlers: { reassignInstrumentColor },
  } = useProjectContext();
  const darkerColor = getDarker(color);
  const isSf2 = isSf2Reference(synthType);
  // SF2 instruments share one fixed dynamicParams set (GM MIDI CC
  // effects - reverb/chorus/brightness/vibrato, sent as real per-channel
  // controller messages - utils/sf2Engine.js's SF2_DYNAMIC_PARAMS) rather
  // than per-instrument custom ones like built-ins have.
  const dynamicParams = isSf2 ? SF2_DYNAMIC_PARAMS : SYNTH_PRESETS[synthType].dynamicParams;
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [sf2State, setSf2State] = useState(getSf2State);

  useEffect(() => subscribeSf2Engine(setSf2State), []);

  // an SF2 instrument has no samples to play until a SoundFont has
  // actually finished loading (the bundled default is 178MB and can take
  // a real while) - without this, clicking preview during that window
  // just silently does nothing, same gap InstrumentPicker's list already
  // guards against for its own items
  const isPreviewDisabled = isSf2 && !sf2State.currentSoundFontName;

  const handlePreviewClick = () => {
    if (isPreviewDisabled) return;
    previewInstrument(synthType, {
      onStart: () => setIsPreviewLoading(true),
      onEnd: () => setIsPreviewLoading(false),
    });
  };

  return (
    <div
      className={styles.colorController}
      style={{ backgroundColor: darkerColor }}
    >
      <div className={styles.titleBar} style={{ backgroundColor: darkerColor }}>
        <InstrumentPicker
          value={synthType}
          color={color}
          onChange={value => {
            dispatch({
              type: PROJECT_ACTIONS.SET_INSTRUMENT_FOR_COLOR,
              payload: {
                colorIndex,
                instrumentName: value,
              },
            });
          }}
        />
        <ColorSwatchPicker
          colorIndex={colorIndex}
          activeColorIndices={activeColorIndices}
          onChange={newColorIndex => reassignInstrumentColor(colorIndex, newColorIndex)}
        />
        <Button
          title={isPreviewDisabled ? 'SoundFont still loading...' : 'Preview this instrument'}
          color={color}
          disabled={isPreviewDisabled}
          onClick={handlePreviewClick}
        >
          <i className={isPreviewLoading ? 'ion-load-c' : 'ion-play'} />
        </Button>
        {canRemove && (
          <Button title="Remove this instrument" color={color} onClick={onRemove}>
            <i className="ion-close" />
          </Button>
        )}
      </div>

      <div className={styles.knobsContainer} style={{ backgroundColor: color }}>
        {dynamicParams.map(({ name }, i) => (
          <div key={`${color}-knob-${name}`}>
            <Knob
              paramName={name}
              value={knobVals[i]}
              onChange={val => {
                dispatch({
                  type: PROJECT_ACTIONS.SET_KNOB_VALUE_FOR_COLOR,
                  payload: { colorIndex, effectIndex: i, value: val },
                });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

ColorControllerComponent.propTypes = propTypes;

export default ColorControllerComponent;
