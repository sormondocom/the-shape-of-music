import React, { useState, useEffect, useRef } from 'react';
import cx from 'classnames';
import { themeColors } from 'utils/color';
import styles from './styles.module.css';
import { SEND_CHANNELS } from 'utils/music';
import {
  getSf2State,
  subscribeSf2Engine,
  loadSoundFont,
  loadDefaultSoundFont,
} from 'utils/sf2Engine';
import { showErrorMessage, showSuccessMessage } from 'utils/message';
import { PROJECT_ACTIONS } from 'utils/project';

import ColorController from './ColorController';
import { useProjectContext } from 'context/useProjectContext';

/*
  What SoundFont is active, plus the upload control - lives here (not the
  Project reducer) because utils/sf2Engine.js already owns this as simple
  module-level state with its own subscribe/notify pub-sub; nothing else
  in the app needs it to flow through the reducer.
*/
function SoundFontHeader() {
  const [sf2State, setSf2State] = useState(getSf2State);
  const fileInputRef = useRef();

  useEffect(() => {
    const unsubscribe = subscribeSf2Engine(setSf2State);
    // fire-and-forget - runs in the background, doesn't block anything
    // else in the app while a (potentially large) default file loads
    loadDefaultSoundFont();
    return unsubscribe;
  }, []);

  const handleFileChange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await loadSoundFont(buffer, file.name);
      showSuccessMessage(`Loaded SoundFont: ${file.name}`);
    } catch (err) {
      showErrorMessage('Could not load that SoundFont file');
    }
  };

  const label = sf2State.isLoadingDefault
    ? 'Loading default SoundFont...'
    : sf2State.currentSoundFontName
    ? `SoundFont: ${sf2State.currentSoundFontName}`
    : 'No SoundFont loaded';

  return (
    <div className={styles.soundFontHeader}>
      <span>{label}</span>
      <button onClick={() => fileInputRef.current.click()}>Upload SoundFont...</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".sf2,.sf3"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}

function ColorControllerPanel() {
  const { knobVals, selectedSynths, activeColorIndices, dispatch } = useProjectContext();
  const [isCollapsed, setCollapsed] = useState(false);
  const canAdd = activeColorIndices.length < themeColors.length;
  const canRemove = activeColorIndices.length > 1;

  return (
    <div className={styles.wrapper}>
      <div
        id="colorControllerPanel"
        className={cx({
          [styles.colorControllerPanel]: true,
          [styles.isCollapsed]: isCollapsed,
        })}
      >
        <div
          className={styles.toggleCollapseButton}
          onClick={() => setCollapsed(!isCollapsed)}
        />
        <SoundFontHeader />
        <div className={styles.colorControllers}>
          {activeColorIndices.map(colorIndex => {
            const synthType = selectedSynths[colorIndex];
            return (
              <div className={styles.colorControllerContainer} key={`colorController-${colorIndex}`}>
                <ColorController
                  colorIndex={colorIndex}
                  // TODO: Compute these in ColorController component
                  color={themeColors[colorIndex]}
                  synthType={synthType}
                  receiveChannel={`${SEND_CHANNELS.FX_PREFIX}${colorIndex}`}
                  knobVals={knobVals[colorIndex]}
                  activeColorIndices={activeColorIndices}
                  canRemove={canRemove}
                  onRemove={() =>
                    dispatch({
                      type: PROJECT_ACTIONS.REMOVE_INSTRUMENT_CHANNEL,
                      payload: { colorIndex },
                    })
                  }
                />
              </div>
            );
          })}
          {canAdd && (
            <button
              className={styles.addInstrumentButton}
              title="Add an instrument"
              onClick={() => dispatch({ type: PROJECT_ACTIONS.ADD_INSTRUMENT_CHANNEL })}
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ColorControllerPanel;
