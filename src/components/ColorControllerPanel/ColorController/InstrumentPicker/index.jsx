import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import Portal from 'react-portal';

import { ALL_SYNTHS, SYNTH_PRESETS } from 'instrumentPresets';
import { GM_FAMILIES, GM_FAMILY_SIZE, GM_INSTRUMENT_NAMES } from 'utils/generalMidi';
import { previewInstrument } from 'utils/instrumentPreview';
import {
  makeSf2Reference,
  isSf2Reference,
  parseSf2Program,
  getPresetList,
  getSf2State,
  subscribeSf2Engine,
} from 'utils/sf2Engine';
import styles from './styles.module.css';

const propTypes = {
  value: PropTypes.string.isRequired,
  color: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

/*
  Replaces the old flat CustomSelect dropdown - with up to 128 SF2
  programs plus the 8 built-ins now in play, a flat list isn't browsable.
  Sectioned by General MIDI's own 16 instrument families (utils/
  generalMidi.js), accordion-style (one family open at a time) to keep
  the list manageable. Portal-rendered to document.body, same proven
  pattern as Toolbar/ColorSelect.jsx.
*/
function InstrumentPicker({ value, color, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [expandedFamily, setExpandedFamily] = useState(null);
  const [sf2State, setSf2State] = useState(getSf2State);
  const [previewingValue, setPreviewingValue] = useState(null);
  const wrapperRef = useRef();

  useEffect(() => subscribeSf2Engine(setSf2State), []);

  const presetList = getPresetList();
  const hasSoundFont = !!sf2State.currentSoundFontName;

  const presetNameFor = program => {
    const match = presetList.find(p => p.program === program && p.bankMSB === 0);
    return (match && match.name) || GM_INSTRUMENT_NAMES[program];
  };

  const currentLabel = isSf2Reference(value)
    ? presetNameFor(parseSf2Program(value))
    : (SYNTH_PRESETS[value] && SYNTH_PRESETS[value].name) || value;

  const handleOpen = () => {
    const rect = wrapperRef.current.getBoundingClientRect();
    setPosition({ top: rect.top, left: rect.left });
    setIsOpen(true);
  };

  const handlePick = newValue => {
    onChange(newValue);
    setIsOpen(false);
  };

  // auditions an item while browsing, without picking it - separate from
  // the single "preview current instrument" button in ColorController's
  // title bar, which only plays whatever's already assigned
  const handlePreviewClick = (e, previewValue) => {
    e.stopPropagation();
    setPreviewingValue(previewValue);
    previewInstrument(previewValue, {
      onEnd: () => setPreviewingValue(null),
    });
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <button
        className={styles.trigger}
        style={{ backgroundColor: color }}
        title={currentLabel}
        onClick={handleOpen}
      >
        {currentLabel}
      </button>
      {isOpen && (
        <Portal isOpened>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div
            className={styles.panel}
            style={{ top: position.top, left: position.left, transform: 'translateY(-100%)' }}
          >
            <div className={styles.sectionHeader}>Built-in</div>
            {ALL_SYNTHS.map(opt => (
              <div key={opt.value} className={styles.itemRow}>
                <button className={styles.item} onClick={() => handlePick(opt.value)}>
                  {opt.label}
                </button>
                <button
                  className={styles.previewButton}
                  title="Preview"
                  onClick={e => handlePreviewClick(e, opt.value)}
                >
                  <i className={previewingValue === opt.value ? 'ion-load-c' : 'ion-play'} />
                </button>
              </div>
            ))}

            {GM_FAMILIES.map((familyName, familyIndex) => {
              const isExpanded = expandedFamily === familyIndex;
              return (
                <div key={familyName}>
                  <button
                    className={styles.sectionHeader}
                    onClick={() => setExpandedFamily(isExpanded ? null : familyIndex)}
                  >
                    {isExpanded ? '▾' : '▸'} {familyName}
                    {!hasSoundFont ? ' (upload a SoundFont)' : ''}
                  </button>
                  {isExpanded &&
                    Array.from({ length: GM_FAMILY_SIZE }, (_, i) => {
                      const program = familyIndex * GM_FAMILY_SIZE + i;
                      const sf2Value = makeSf2Reference(program);
                      return (
                        <div key={program} className={styles.itemRow}>
                          <button
                            className={styles.item}
                            disabled={!hasSoundFont}
                            onClick={() => handlePick(sf2Value)}
                          >
                            {presetNameFor(program)}
                          </button>
                          <button
                            className={styles.previewButton}
                            title="Preview"
                            disabled={!hasSoundFont}
                            onClick={e => handlePreviewClick(e, sf2Value)}
                          >
                            <i
                              className={
                                previewingValue === sf2Value ? 'ion-load-c' : 'ion-play'
                              }
                            />
                          </button>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </Portal>
      )}
    </div>
  );
}

InstrumentPicker.propTypes = propTypes;

export default InstrumentPicker;
