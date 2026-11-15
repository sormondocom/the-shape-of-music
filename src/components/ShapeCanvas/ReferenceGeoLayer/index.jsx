import React from 'react';
import PropTypes from 'prop-types';
import { Layer, Line } from 'react-konva';

const propTypes = {
  referenceGeoLayers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      tracks: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)).isRequired,
      isVisible: PropTypes.bool,
    })
  ).isRequired,
  selectedReferenceGeoLayerId: PropTypes.string,
  stageScale: PropTypes.number.isRequired,
};

/*
  A "Reference" geo import (Toolbar's GeoImportModeModal) - every feature
  in the file rendered as ONE static, non-interactive backdrop, not as
  individual shapesList entries. Deliberately NOT built on Shape/
  ComponentV2.jsx's machinery: no per-vertex edit handles, no Synth/
  Tone.Part (Shape/useShapeSynth.js constructs one of those per shape
  unconditionally on mount, regardless of viewport culling - exactly the
  cost this mode exists to avoid for a file with hundreds or thousands of
  features), no per-feature LayersPanel row. A shapefile with 1,900
  features becomes ONE layer, one row, zero new instrument voices - same
  spirit as ReferenceImage, just vector geometry instead of a raster.

  listening={false} throughout - nothing here is meant to be clicked on
  the canvas; selecting/deleting a reference layer happens from its one
  LayersPanel row instead.

  Every shape in this app loops its points back to the start for playback
  (Shape/Synth.js's own "last edge" wraparound) regardless of whether the
  source geometry was actually a closed ring - rendering closed here too
  just keeps a reference layer's outline looking like what the SAME
  tracks would look like if imported as audible shapes instead.
*/
function ReferenceGeoLayer({ referenceGeoLayers, selectedReferenceGeoLayerId, stageScale }) {
  if (!referenceGeoLayers.length) return null;

  return (
    <Layer listening={false}>
      {referenceGeoLayers.map(layer => {
        // Same isVisible !== false convention as a shape's own visibility
        // toggle (ShapeCanvas/Container.jsx's handleShapeVisibilityChange)
        // - undefined/true means visible, only an explicit false hides it.
        // Unlike a shape, there's no audio to also silence - a reference
        // layer never had any (that's the whole point of Reference mode),
        // so hiding it is purely this render skip.
        if (layer.isVisible === false) return null;
        const isSelected = layer.id === selectedReferenceGeoLayerId;
        return layer.tracks.map((points, i) => (
          <Line
            key={`${layer.id}-${i}`}
            points={points}
            closed
            stroke={isSelected ? '#00aaff' : 'rgba(128, 128, 128, 0.6)'}
            strokeWidth={(isSelected ? 2 : 1) / stageScale}
            listening={false}
          />
        ));
      })}
    </Layer>
  );
}

ReferenceGeoLayer.propTypes = propTypes;

export default ReferenceGeoLayer;
