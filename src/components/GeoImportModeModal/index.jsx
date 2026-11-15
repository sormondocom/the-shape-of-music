import React from 'react';
import PropTypes from 'prop-types';
import Portal from 'react-portal';

import Button from 'components/Button';
import { appColors } from 'utils/color';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import styles from './styles.module.css';

const propTypes = {
  sourceLabel: PropTypes.string.isRequired,
  featureCount: PropTypes.number.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

/*
  The first thing Toolbar's handleGeoFileChange asks for every geo import
  (GPX/KML/GeoJSON/Shapefile), before any density check or simplification -
  an explicit, one-or-the-other choice between two genuinely different
  destinations for the same geometry:

  - Sound Layer: today's existing path - each feature becomes its own
    audible shapesList entry with an instrument assigned (ShapeCanvas/
    Container.jsx's importGeoShapes). Right for a handful of meaningful
    routes (a hike, a flight) where hearing each one individually is the
    point.
  - Reference: every feature becomes ONE static backdrop layer
    (ReferenceGeoLayer) - no instrument, no individual LayersPanel row, no
    Synth/Tone.Part construction at all. Right for a file whose features
    aren't meant to be heard individually at all (a county shapefile's
    1,900 subdivisions) - you want to SEE the shape of the place, not an
    instrument channel per administrative boundary.

  Deliberately not an "and" - picking one doesn't offer the other later
  for this same import; the user has to actually mean one or the other.
*/
function GeoImportModeModal({ sourceLabel, featureCount, onConfirm, onCancel }) {
  const { isDarkMode } = useColorThemeContext();

  return (
    <Portal isOpened>
      <div className={styles.backdrop} />
      <div
        className={styles.panel}
        style={{
          background: isDarkMode ? '#2b2b2b' : '#fff',
          color: isDarkMode ? '#eee' : appColors.black,
        }}
      >
        <div className={styles.header}>
          <span>Import {sourceLabel}</span>
        </div>
        <div className={styles.body}>
          <p className={styles.blurb}>
            {featureCount.toLocaleString()} shape{featureCount === 1 ? '' : 's'} found. How
            should this be imported?
          </p>
          <div className={styles.optionGrid}>
            <button className={styles.option} onClick={() => onConfirm('sound')}>
              <span className={styles.optionTitle}>Sound Layer</span>
              <span className={styles.optionDesc}>
                Each shape becomes its own audible, instrument-assigned layer. Best for a
                handful of meaningful routes (a hike, a flight) you want to hear individually.
              </span>
            </button>
            <button className={styles.option} onClick={() => onConfirm('reference')}>
              <span className={styles.optionTitle}>Reference</span>
              <span className={styles.optionDesc}>
                Every shape becomes one static backdrop layer - visible, not audible, no
                instrument used. Best for a file with many features you want to see the
                outline of (a county shapefile), not hear one by one.
              </span>
            </button>
          </div>
        </div>
        <div className={styles.footer}>
          <Button color={appColors.grayLight} onClick={onCancel}>
            Cancel Import
          </Button>
        </div>
      </div>
    </Portal>
  );
}

GeoImportModeModal.propTypes = propTypes;

export default GeoImportModeModal;
