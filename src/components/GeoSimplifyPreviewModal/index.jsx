import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Portal from 'react-portal';

import Button from 'components/Button';
import { appColors } from 'utils/color';
import { douglasPeucker, getBoundingBoxDiagonal, uniformPreSample } from 'utils/simplify';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import styles from './styles.module.css';

const propTypes = {
  // EVERY usable track from this import (not just the dense ones) - raw
  // [{ lat, lon }, ...] per track, full resolution. A county shapefile's
  // individual polygon means nothing simplified in isolation; what
  // actually needs judging is the whole composite (every shape at its
  // real relative position) zoomed out to where it'll actually be seen.
  // Only ever used here to build small per-track preview working sets -
  // the actual import re-simplifies each real, full-resolution track at
  // commit time (utils/geoTrackImport.js's simplifyTrackForImport).
  tracks: PropTypes.arrayOf(
    PropTypes.arrayOf(PropTypes.shape({ lat: PropTypes.number, lon: PropTypes.number }))
  ).isRequired,
  // How many of these tracks are dense enough to actually be affected by
  // the slider at all - the rest render in both layers unchanged.
  denseTrackCount: PropTypes.number.isRequired,
  minRatio: PropTypes.number.isRequired,
  maxRatio: PropTypes.number.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

// Total points across every track's preview working set, combined - kept
// roughly constant regardless of how many tracks there are (a single huge
// feature gets a rich, detailed preview; a county file's 1,900 small-ish
// subdivisions each get a thin slice, same total DP work either way) so
// recomputing on slider drag stays fast no matter the shape of the file.
const TOTAL_PREVIEW_POINT_BUDGET = 20000;
const MIN_PER_TRACK_BUDGET = 20;
const MAX_PER_TRACK_BUDGET = 3000;
// Debounces the expensive recompute while dragging (not the slider's own
// displayed position, which still tracks the pointer instantly) - a few
// hundred tracks' worth of DP is fast but not zero-cost, and redoing it on
// every pixel of pointer movement is what would make dragging feel janky.
const RECOMPUTE_DEBOUNCE_MS = 60;
const VIEW_W = 300;
const VIEW_H = 190;
const PADDING = 16;

const toXY = ({ lat, lon }) => [lon, lat];

const getPerTrackBudget = trackCount =>
  Math.max(
    MIN_PER_TRACK_BUDGET,
    Math.min(MAX_PER_TRACK_BUDGET, Math.round(TOTAL_PREVIEW_POINT_BUDGET / trackCount))
  );

// Builds one SVG path string for a single track's xyPoints, scaled/
// centered into the shared viewBox using bounds computed from every
// track's working set COMBINED (not just this one) - so every track stays
// at its correct position relative to every other one, the whole point of
// previewing the composite rather than one shape in isolation.
const toPath = (xyPoints, bounds) => {
  if (xyPoints.length === 0) return '';
  const { minX, minY, maxX, maxY } = bounds;
  const w = Math.max(maxX - minX, 1e-9);
  const h = Math.max(maxY - minY, 1e-9);
  const scale = Math.min((VIEW_W - PADDING * 2) / w, (VIEW_H - PADDING * 2) / h);
  const offsetX = PADDING + (VIEW_W - PADDING * 2 - w * scale) / 2;
  const offsetY = PADDING + (VIEW_H - PADDING * 2 - h * scale) / 2;
  return xyPoints
    .map(([x, y], i) => {
      const px = offsetX + (x - minX) * scale;
      const py = offsetY + (maxY - y) * scale; // flip Y so north stays up
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ');
};

// One concatenated path (each track its own M...L subpath) rather than one
// <path> per track - a county file can mean hundreds of tracks, and a
// single path string is far cheaper to mount/update than that many
// separate DOM nodes for a preview that doesn't need per-track interactivity.
const toMultiPath = (tracksXY, bounds) => tracksXY.map(xy => toPath(xy, bounds)).join(' ');

/*
  Shown by Toolbar's handleGeoFileChange when a geo import (GPX/KML/
  GeoJSON/Shapefile) has at least one track dense enough to cross
  utils/geoTrackImport.js's SIMPLIFY_REVIEW_THRESHOLD - a chance to see
  and control what the mandatory per-shape simplification (that file's
  getMaxPointsPerTrack - every shape in an import shares one total point
  budget) will actually do before committing to it, rather than a single
  silent auto-simplify.

  The slider's range is already safe: minRatio is the smallest ratio
  findMinSafeRatio found for the single densest track against that same
  budget, so every position on the slider is guaranteed to import without
  the freeze getMaxPointsPerTrack exists to prevent (every OTHER track
  gets its own correct, safe result at commit time regardless of what's
  chosen here - see Toolbar's own comment on this) - this is purely about
  fidelity vs. simplicity within that already-safe range, never about
  re-litigating the cap itself.
*/
function GeoSimplifyPreviewModal({
  tracks,
  denseTrackCount,
  minRatio,
  maxRatio,
  onConfirm,
  onCancel,
}) {
  const { isDarkMode } = useColorThemeContext();
  // sliderValue tracks the pointer instantly; appliedRatio is what actually
  // drives the (debounced) recompute below - see RECOMPUTE_DEBOUNCE_MS.
  const [sliderValue, setSliderValue] = useState(minRatio);
  const [appliedRatio, setAppliedRatio] = useState(minRatio);

  useEffect(() => {
    const id = setTimeout(() => setAppliedRatio(sliderValue), RECOMPUTE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [sliderValue]);

  // Built once per modal open (tracks' identity is stable for the modal's
  // whole lifetime) - the per-track pre-sampling is the only step whose
  // cost scales with the FULL file, so it must never re-run on slider drag.
  const workingSets = useMemo(() => {
    const perTrackBudget = getPerTrackBudget(tracks.length);
    return tracks.map(track => uniformPreSample(track.map(toXY), perTrackBudget));
  }, [tracks]);

  const bounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    workingSets.forEach(xy =>
      xy.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      })
    );
    return { minX, minY, maxX, maxY };
  }, [workingSets]);

  const simplifiedSets = useMemo(
    () =>
      workingSets.map(xy => {
        const diagonal = getBoundingBoxDiagonal(xy);
        return douglasPeucker(xy, Math.max(1e-9, diagonal * appliedRatio));
      }),
    [workingSets, appliedRatio]
  );

  const fullPath = useMemo(() => toMultiPath(workingSets, bounds), [workingSets, bounds]);
  const simplifiedPath = useMemo(
    () => toMultiPath(simplifiedSets, bounds),
    [simplifiedSets, bounds]
  );

  const totalRawPoints = useMemo(
    () => tracks.reduce((sum, t) => sum + t.length, 0),
    [tracks]
  );
  const totalSimplifiedPoints = useMemo(
    () => simplifiedSets.reduce((sum, xy) => sum + xy.length, 0),
    [simplifiedSets]
  );

  // slider moves left-to-right as "more detail -> more simplified", so
  // position maps directly to ratio - no inversion to keep track of
  const sliderPercent =
    maxRatio === minRatio ? 0 : (sliderValue - minRatio) / (maxRatio - minRatio);

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
          <span>Simplify before importing</span>
        </div>
        <div className={styles.body}>
          <p className={styles.blurb}>
            {tracks.length.toLocaleString()} shape{tracks.length === 1 ? '' : 's'} found
            ({totalRawPoints.toLocaleString()} points total) -{' '}
            {denseTrackCount === tracks.length
              ? 'all of them'
              : `${denseTrackCount.toLocaleString()} of them`}{' '}
            dense enough for this slider to actually affect. The preview below shows
            every shape together, at its real relative position, zoomed out the way
            you'd actually see them - drag to compare. Every position is already safe
            to import; this is purely about quality.
          </p>
          <svg
            className={styles.preview}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            width="100%"
            height={VIEW_H}
          >
            <path
              d={fullPath}
              fill="none"
              stroke={isDarkMode ? '#666' : '#ccc'}
              strokeWidth="1"
            />
            <path d={simplifiedPath} fill="none" stroke="#00aaff" strokeWidth="1.25" />
          </svg>
          <div className={styles.sliderRow}>
            <span className={styles.sliderEndLabel}>More detail</span>
            <input
              className={styles.slider}
              type="range"
              min={minRatio}
              max={maxRatio}
              step={(maxRatio - minRatio) / 200 || 0.0001}
              value={sliderValue}
              onChange={e => setSliderValue(Number(e.target.value))}
            />
            <span className={styles.sliderEndLabel}>Simpler</span>
          </div>
          <p className={styles.stats}>
            Roughly {totalSimplifiedPoints.toLocaleString()} of {totalRawPoints.toLocaleString()}{' '}
            points would remain across every shape (estimated from a representative sample -
            the real import simplifies each shape's full resolution).
          </p>
        </div>
        <div className={styles.footer}>
          <Button color={appColors.grayLight} onClick={onCancel}>
            Cancel Import
          </Button>
          <Button color={appColors.black} hasBorder onClick={() => onConfirm(sliderValue)}>
            <span className={styles.confirmLabel}>
              Import with this simplification ({Math.round(sliderPercent * 100)}%)
            </span>
          </Button>
        </div>
      </div>
    </Portal>
  );
}

GeoSimplifyPreviewModal.propTypes = propTypes;

export default GeoSimplifyPreviewModal;
