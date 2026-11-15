import React, { useRef, useState } from 'react';
import cx from 'classnames';
import { Popconfirm, Popover, Tooltip } from 'antd';

import Button from 'components/Button';
import CheckboxButton from 'components/CheckboxButton';
import CustomSelect from 'components/CustomSelect';
import TempoInput from 'components/TempoInput';
import GeoImportLogModal from 'components/GeoImportLogModal';
import GeoSimplifyPreviewModal from 'components/GeoSimplifyPreviewModal';
import GeoImportModeModal from 'components/GeoImportModeModal';

import DrawToolIcon from 'components/icons/DrawTool';
import EditToolIcon from 'components/icons/EditTool';
import { appColors, getDarker, THEMES } from 'utils/color';
import { Midi } from '@tonejs/midi';
import { PRESET_SHAPES } from 'utils/shape';
import { convertMidiTrackToPoints, assignMidiImportChannels } from 'utils/midiImport';
import {
  parseTracksFromGeoFile,
  toPoints,
  MAX_IMPORTED_GEO_SHAPES,
  getMaxPointsPerTrack,
  SIMPLIFY_REVIEW_THRESHOLD,
  findMinSafeRatio,
  simplifyTrackForImport,
} from 'utils/geoTrackImport';
import { parseShapefile } from 'utils/shapefileImport';
import { readFileAsDataURL } from 'utils/file';
import { showErrorMessage } from 'utils/message';

import styles from './styles.module.css';

import {
  MAX_PROXIMITY_RADIUS,
  MIN_PROXIMITY_RADIUS,
  TOOL_TYPES,
  CANVAS_MODES,
  getCanvasWidth,
} from 'utils/project';
import { PROXIMITY_MODE_RADIUS, SCALES, TONICS } from 'utils/music';

import ColorSelect from './ColorSelect';
import { PROJECT_ACTIONS } from 'utils/project';
import { useProjectContext } from 'context/useProjectContext';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import {
  ImportOutlined,
  PictureOutlined,
  QuestionCircleOutlined,
  BulbFilled,
  BulbOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import CustomSlider from 'components/Slider';

const { white, black, grayLightest } = appColors;

// How many tracks handleGeoFileChange simplifies before yielding back to
// the browser - see its own comment at the simplification loop below for
// why this exists at all.
const SIMPLIFY_CHUNK_SIZE = 25;
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

function ToolbarComponent() {
  const {
    activeTool,
    scaleObj,
    tempo,
    isGridActive,
    isAutoQuantizeActive,
    isProximityModeActive,
    proximityModeRadius,
    canvasMode,
    activeColorIndices,
    dispatch,
    imperativeHandlers: {
      clearProjectCanvas,
      insertPresetShape,
      importMidiShapes,
      importGeoShapes,
      resetPlaybackPosition,
    },
  } = useProjectContext();

  const lightGray = getDarker(grayLightest);
  const isDrawTool = activeTool === TOOL_TYPES.DRAW;
  const isEditTool = activeTool === TOOL_TYPES.EDIT;

  const { isDarkMode, setTheme } = useColorThemeContext();

  const fileInputRef = useRef();
  const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/gif', 'image/jpeg'];

  const handleImageFileChange = async e => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;

    const canvasWidth = getCanvasWidth();
    const canvasHeight = window.innerHeight - 80;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        showErrorMessage(`Skipped ${file.name} - please select PNG, GIF, or JPEG images`);
        continue;
      }

      const src = await readFileAsDataURL(file);
      await new Promise(resolve => {
        const img = new window.Image();
        img.onload = () => {
          const maxWidth = canvasWidth * 0.5;
          const maxHeight = canvasHeight * 0.5;
          const scale = Math.min(
            maxWidth / img.naturalWidth,
            maxHeight / img.naturalHeight,
            1
          );
          const width = img.naturalWidth * scale;
          const height = img.naturalHeight * scale;
          // stagger multiple imports so they don't land exactly on top of
          // one another
          const stagger = i * 24;

          dispatch({
            type: PROJECT_ACTIONS.ADD_REFERENCE_IMAGE,
            payload: {
              id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
              src,
              width,
              height,
              x: (canvasWidth - width) / 2 + stagger,
              y: (canvasHeight - height) / 2 + stagger,
            },
          });
          resolve();
        };
        img.src = src;
      });
    }

    // land in Edit mode so the image(s) are immediately movable/selectable;
    // the user can switch to Draw themselves when they're ready to trace
    dispatch({ type: PROJECT_ACTIONS.SET_ACTIVE_TOOL, payload: TOOL_TYPES.EDIT });
  };

  const midiFileInputRef = useRef();
  const geoFileInputRef = useRef();

  // Drives GeoImportLogModal - null while hidden. Lives here (not the
  // shared Project reducer) since nothing outside this file's own
  // handleGeoFileChange ever needs to read or set it.
  const [geoImportLog, setGeoImportLog] = useState(null);
  const appendGeoImportLog = (text, type = 'info') =>
    setGeoImportLog(prev => prev && { ...prev, entries: [...prev.entries, { text, type }] });
  const finishGeoImportLog = status =>
    setGeoImportLog(prev => prev && { ...prev, status });

  // Drives GeoSimplifyPreviewModal, shown before GeoImportLogModal when a
  // geo import has at least one track dense enough to need review - null
  // while hidden. simplifyResolverRef bridges that modal's button clicks
  // back into handleGeoFileChange's otherwise-linear async flow (see
  // promptSimplification below).
  const [geoSimplifyReview, setGeoSimplifyReview] = useState(null);
  const simplifyResolverRef = useRef(null);

  // Drives GeoImportModeModal - the first thing shown for every geo
  // import (before the simplify review, before the log), asking Sound
  // Layer vs Reference. Same resolver-ref bridge pattern as
  // simplifyResolverRef above.
  const [geoImportModePrompt, setGeoImportModePrompt] = useState(null);
  const importModeResolverRef = useRef(null);
  const promptImportMode = (sourceLabel, featureCount) =>
    new Promise(resolve => {
      importModeResolverRef.current = resolve;
      setGeoImportModePrompt({ sourceLabel, featureCount });
    });

  const handleMidiFileChange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    if (!/\.midi?$/i.test(file.name)) {
      showErrorMessage('Please select a .mid or .midi file');
      return;
    }

    let midi;
    try {
      const arrayBuffer = await file.arrayBuffer();
      midi = new Midi(arrayBuffer);
    } catch (err) {
      showErrorMessage('Could not read that MIDI file');
      return;
    }

    const results = midi.tracks
      // channel 9 is the General MIDI percussion channel - its "notes" are
      // drum-kit slots, not pitches, so converting them as scale degrees is
      // musically meaningless and they're usually the densest track in a file
      .filter(track => track.channel !== 9 && track.notes.length)
      .map(track => {
        const converted = convertMidiTrackToPoints({ notes: track.notes, scaleObj });
        if (!converted) return null;
        // the GM program this track was actually written for - now that
        // SF2 instruments cover all 128 GM programs (not just the ~8
        // built-in types), each track can get its own real instrument
        // instead of every imported shape sharing whatever's currently
        // selected.
        return { ...converted, program: track.instrument.number };
      })
      .filter(result => result !== null);

    const pointsLists = results.map(result => result.points);
    const noteEventsLists = results.map(result => result.noteEvents);
    // each track's own first-note onset (real seconds, file-absolute) -
    // ShapeCanvas/Container.jsx turns these into relative per-shape
    // startOffsets (the earliest track starts immediately, the rest enter
    // however much later they did in the source file)
    const startTimes = results.map(result => result.startTime);
    // One shared loop length for every shape from this same import, instead
    // of each shape looping at whatever its own note content happens to
    // add up to (see convertMidiTrackToPoints' endTime comment) - spans
    // from the earliest track's entrance to the latest track's own last
    // note-off, so every imported shape keeps the same phase relationship
    // to every other one, forever, instead of slowly drifting apart.
    const commonLoopDuration = results.length
      ? Math.max(...results.map(result => result.endTime)) -
        Math.min(...startTimes)
      : 0;

    // A MIDI import now clears the canvas first (importMidiShapes below) and
    // replaces the active instrument set to match, rather than piling the
    // new tracks' instruments on top of whatever was already active - so
    // channel assignment starts fresh (empty activeColorIndices/
    // selectedSynths) instead of reusing the project's current ones.
    const { assignments, colorIndexForTrack } = assignMidiImportChannels({
      programs: results.map(result => result.program),
      activeColorIndices: [],
      selectedSynths: [],
    });
    if (assignments.length) {
      dispatch({ type: PROJECT_ACTIONS.REPLACE_INSTRUMENT_CHANNELS, payload: assignments });
    }

    // The imported file's own name is tracked separately from the
    // project's name (state.importedFileNames, shown by FileNameBadge
    // indented underneath the project name in a clearly different style) -
    // never written into projectName itself. projectName only ever labels
    // this app's own SAVED PROJECT (the local .geob format - utils/
    // file.js's saveProjectAsGeob) and feeds straight into MIDI-export's
    // own filename (convertAndDownloadTracksAsMIDI); conflating it with
    // the source MIDI file's name used to make a save dialog look like it
    // could overwrite or replace the original import, which it never did
    // and never will - this is only ever this app's own project data.
    //
    // A MIDI import replaces the whole canvas (importMidiShapes below), so
    // it replaces the whole imported-files list too, rather than piling
    // this file on top of whatever was already there.
    dispatch({
      type: PROJECT_ACTIONS.SET_IMPORTED_FILE_NAMES,
      payload: [file.name],
    });

    // Without this, importing while playback is still running (never
    // paused/stopped first) mounts the new shapes against whatever
    // Transport position was already mid-piece - each one's own
    // startOffset ends up scheduled in the past, so Tone.js starts it
    // immediately rather than waiting, landing it mid-loop based on that
    // stale position instead of its own beginning. Visibly: the new
    // import "picks up where the old one left off" instead of starting
    // fresh. See useAudioOutput's resetPosition for the full version.
    resetPlaybackPosition();

    importMidiShapes(pointsLists, noteEventsLists, colorIndexForTrack, startTimes, commonLoopDuration);
  };

  // Geographic mode's GIS vector import (GPX/KML/GeoJSON/Shapefile -
  // flight routes, hiking tracks, survey points, any other point/line/
  // polygon layer). Unlike MIDI import, this ADDS to the canvas rather
  // than replacing it (utils/geoTrackImport.js's own comment on why: a
  // track has no pitch data of its own, so there's nothing to protect
  // from an existing composition the way MIDI's exact pitches needed a
  // clean slate for) - so there's no clear/reset here at all. Every
  // imported feature becomes a shape positioned at its real location on
  // the base map (utils/geoTiles.js) and gets assigned an instrument
  // (colorIndexForTrack below) exactly like a hand-drawn shape would -
  // "connect the points and the shapes and assign them an instrument to
  // hear them".
  // Opens GeoSimplifyPreviewModal and resolves once the user confirms a
  // ratio or cancels the whole import - bridges that interaction into
  // handleGeoFileChange's otherwise-linear async flow below.
  const promptSimplification = (tracks, denseTrackCount, minRatio, maxRatio) =>
    new Promise(resolve => {
      simplifyResolverRef.current = resolve;
      setGeoSimplifyReview({ tracks, denseTrackCount, minRatio, maxRatio });
    });

  const handleGeoFileChange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    if (!/\.(gpx|kml|json|geojson|shp|zip)$/i.test(file.name)) {
      showErrorMessage(
        'Please select a .gpx, .kml, .geojson, .json, .shp, or .zip (shapefile) file'
      );
      return;
    }

    const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
    let tracks;
    try {
      tracks =
        extension === 'shp' || extension === 'zip'
          ? await parseShapefile(file)
          : parseTracksFromGeoFile(await file.text(), extension);
    } catch (err) {
      showErrorMessage(`Could not read that file: ${err.message}`);
      return;
    }

    const allUsableTracks = tracks.filter(track => track.length >= 2);
    if (!allUsableTracks.length) {
      showErrorMessage('No usable shapes found in that file');
      return;
    }

    // A rare backstop, not the normal path - MAX_IMPORTED_GEO_SHAPES is
    // high enough that an ordinary county/subdivision-level shapefile
    // never hits it; getMaxPointsPerTrack below is what actually keeps a
    // file with thousands of features importable without dropping any of
    // them. Truncated BEFORE any per-track work, not after, so on the rare
    // file that IS this large, the excess tracks never get simplified just
    // to be thrown away.
    const usableTracks = allUsableTracks.slice(0, MAX_IMPORTED_GEO_SHAPES);
    const trackWord = extension === 'shp' || extension === 'zip' ? 'feature' : 'track';
    // Every shape in THIS import shares one total point budget - a file
    // with many features gets a smaller per-feature cap than one with few,
    // so the aggregate Tone.Part/Konva-node cost stays bounded regardless
    // of feature count instead of multiplying out with it. See utils/
    // geoTrackImport.js's own TOTAL_POINT_BUDGET comment.
    const maxPointsPerTrack = getMaxPointsPerTrack(usableTracks.length);

    // Asked for every geo import, before any density check - an explicit
    // either/or, not a default with a later toggle (see GeoImportModeModal's
    // own comment on why). Everything below (the simplify review, the
    // per-track point reduction) applies the same regardless of which is
    // picked; only the final commit step branches on it.
    const modeDecision = await promptImportMode(file.name, usableTracks.length);
    if (modeDecision.cancelled) return;
    const importMode = modeDecision.mode;

    // Only the genuinely dense tracks get an interactive review - a GPX
    // hike with 600 points still gets auto-capped silently below, same as
    // before. See utils/geoTrackImport.js's SIMPLIFY_REVIEW_THRESHOLD.
    const denseTracks = usableTracks.filter(track => track.length > SIMPLIFY_REVIEW_THRESHOLD);
    let chosenRatio;
    if (denseTracks.length > 0) {
      // Slider bounds come from the single densest track alone, not every
      // dense track - computing findMinSafeRatio for each one up front is
      // exactly the kind of per-track work that freezes a file with
      // thousands of dense features before any modal even appears. Every
      // OTHER dense track still gets a correct, safe result below
      // (simplifyTrackForImport's own per-track fallback), just not
      // factored into where the slider starts.
      //
      // The PREVIEW itself, though, shows every usable track at once (not
      // just that one) - a county shapefile's individual polygons mean
      // nothing in isolation; what the user actually needs to judge is
      // what the whole composite (every county subdivision at its real
      // relative position) looks like simplified, zoomed out to where
      // it'll actually be viewed.
      const densestTrack = denseTracks.reduce((a, b) => (b.length > a.length ? b : a));
      const minRatio = findMinSafeRatio(densestTrack, maxPointsPerTrack);
      const maxRatio = Math.max(minRatio * 6, 0.05);
      const decision = await promptSimplification(
        usableTracks,
        denseTracks.length,
        minRatio,
        maxRatio
      );
      if (decision.cancelled) return;
      chosenRatio = decision.ratio;
    }

    // Opens GeoImportLogModal for the rest of this import - it blocks the
    // canvas (no backdrop-dismiss) until its OK button is clicked, so the
    // shapes below aren't immediately clickable/draggable the instant
    // they're placed, and the user gets a readable record of what
    // happened instead of a toast that's gone a few seconds later.
    const skipped = tracks.length - allUsableTracks.length;
    setGeoImportLog({
      sourceLabel: file.name,
      status: 'running',
      entries: [
        { text: `Read ${file.name}.` },
        {
          text: `Found ${tracks.length} ${trackWord}${tracks.length === 1 ? '' : 's'}.`,
        },
        ...(skipped > 0
          ? [
              {
                text: `Skipped ${skipped} ${trackWord}${
                  skipped === 1 ? '' : 's'
                } with fewer than 2 points.`,
                type: 'warning',
              },
            ]
          : []),
        ...(allUsableTracks.length > usableTracks.length
          ? [
              {
                text: `Capped at ${usableTracks.length} ${trackWord}s (found ${allUsableTracks.length} usable) to avoid freezing the canvas.`,
                type: 'warning',
              },
            ]
          : []),
      ],
    });

    // Tracks above SIMPLIFY_REVIEW_THRESHOLD use the ratio just chosen
    // (or confirmed) above; everything else gets simplifyTrackForImport's
    // own automatic ratio search, scaled to that one track - the user's
    // slider choice, tuned against the densest/largest track, isn't
    // necessarily right for a much smaller one that merely crossed
    // maxPointsPerTrack. Either way, every track gets the SAME
    // maxPointsPerTrack ceiling, computed once above from the whole
    // import's shape count.
    //
    // Done in yielded chunks rather than one big .map() - simplifying even
    // a few hundred tracks is a few milliseconds each (DP's cost, however
    // bounded per-track, still adds up linearly with track count), and a
    // synchronous loop over all of them with zero yields is exactly what
    // trips a browser's "page unresponsive" dialog even though every
    // individual step is fast and bounded. Yielding every
    // SIMPLIFY_CHUNK_SIZE tracks keeps the tab responsive throughout
    // regardless of how many tracks there are, at the cost of the whole
    // step taking slightly longer in wall-clock time.
    const shapes = [];
    for (let i = 0; i < usableTracks.length; i += SIMPLIFY_CHUNK_SIZE) {
      usableTracks.slice(i, i + SIMPLIFY_CHUNK_SIZE).forEach(track => {
        const ratioForTrack = track.length > SIMPLIFY_REVIEW_THRESHOLD ? chosenRatio : undefined;
        const { track: finalTrack, wasSimplified } = simplifyTrackForImport(
          track,
          ratioForTrack,
          maxPointsPerTrack
        );
        shapes.push({ points: toPoints(finalTrack), wasSimplified });
      });
      if (i + SIMPLIFY_CHUNK_SIZE < usableTracks.length) {
        await yieldToMain();
      }
    }

    const trimmedCount = shapes.filter(s => s.wasSimplified).length;
    if (trimmedCount > 0) {
      appendGeoImportLog(
        `Simplified ${trimmedCount} dense ${trackWord}${
          trimmedCount === 1 ? '' : 's'
        } to ${maxPointsPerTrack} points each to keep things responsive.`,
        'warning'
      );
    }

    if (importMode === 'reference') {
      // No instrument assignment, no shapesList entries, no importGeoShapes
      // at all - every feature becomes ONE static layer (ReferenceGeoLayer),
      // dispatched straight into the reducer the same way ADD_REFERENCE_IMAGE
      // already is. Nothing here constructs a Synth/Tone.Part, so (unlike
      // the Sound Layer branch below) there's no per-shape mounting cost to
      // worry about - a few hundred/thousand simple Konva Lines in one
      // layer is cheap regardless of count.
      appendGeoImportLog(
        `Adding ${shapes.length} shape${shapes.length === 1 ? '' : 's'} as a reference layer...`
      );
      dispatch({
        type: PROJECT_ACTIONS.ADD_REFERENCE_GEO_LAYER,
        payload: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceLabel: file.name,
          tracks: shapes.map(s => s.points),
        },
      });
      appendGeoImportLog(
        `Added reference layer with ${shapes.length} shape${shapes.length === 1 ? '' : 's'}.`,
        'success'
      );
      finishGeoImportLog('done');
      return;
    }

    // Cycles through whatever instruments are ALREADY active rather than
    // claiming new channels the way MIDI import does - a track has no GM
    // program to match a real instrument to, so there's no principled
    // way to pick a "correct" new one. A file with more tracks than
    // active instruments just repeats the cycle, same idea as
    // utils/midiImport.js's channel reuse but without the program-match
    // check (nothing to match here).
    const colorIndexForTrack = shapes.map(
      (_, i) => activeColorIndices[i % activeColorIndices.length]
    );

    appendGeoImportLog(
      `Placing ${shapes.length} shape${shapes.length === 1 ? '' : 's'} on the map...`
    );
    // importGeoShapes mounts shapes in yielded batches (see its own
    // comment) rather than one synchronous commit, so this await matters,
    // not just stylistically - without it, handleGeoFileChange would
    // return (and finishGeoImportLog never fire) before the import's own
    // mounting work is actually done.
    const result = await importGeoShapes(shapes.map(s => s.points), colorIndexForTrack);
    if (!result.ok) {
      appendGeoImportLog(result.reason, 'error');
      finishGeoImportLog('error');
      return;
    }
    if (result.totalFound > result.importedCount) {
      appendGeoImportLog(
        `Capped at ${result.importedCount} shape${
          result.importedCount === 1 ? '' : 's'
        } (found ${result.totalFound}) to avoid freezing the canvas.`,
        'warning'
      );
    }
    appendGeoImportLog(
      `Imported ${result.importedCount} shape${result.importedCount === 1 ? '' : 's'}.`,
      'success'
    );
    // Unlike a MIDI import (which replaces the whole canvas, and so
    // replaces the whole imported-files list), this ADDS shapes to
    // whatever's already there - so it adds this file's name to the list
    // too, rather than replacing it. See FileNameBadge.
    dispatch({ type: PROJECT_ACTIONS.ADD_IMPORTED_FILE_NAME, payload: file.name });
    finishGeoImportLog('done');
  };

  return (
    <div
      className={styles.toolbar}
      style={{ background: isDarkMode && '#333' }}
    >
      {/* TOOL CONTROLS */}
      <div className={cx(styles.toolbarSection, styles.toolSelect)}>
        <ColorSelect />
        <Tooltip
          title={
            <span>
              Draw Tool <span style={{ opacity: 0.6 }}>(TAB)</span>
            </span>
          }
        >
          <div>
            <Button
              hasBorder
              color={isDrawTool ? black : grayLightest}
              onClick={() => {
                dispatch({
                  type: PROJECT_ACTIONS.SET_ACTIVE_TOOL,
                  payload: TOOL_TYPES.DRAW,
                });
              }}
            >
              <DrawToolIcon fill={isDrawTool ? grayLightest : black} />
            </Button>
          </div>
        </Tooltip>
        <Tooltip
          title={
            <span>
              Edit Tool <span style={{ opacity: 0.6 }}>(TAB)</span>
            </span>
          }
        >
          <div>
            <Button
              hasBorder
              color={isEditTool ? black : grayLightest}
              onClick={() => {
                dispatch({
                  type: PROJECT_ACTIONS.SET_ACTIVE_TOOL,
                  payload: TOOL_TYPES.EDIT,
                });
              }}
            >
              <EditToolIcon fill={!isDrawTool ? grayLightest : black} />
            </Button>
          </div>
        </Tooltip>
      </div>

      {/* INSERT SHAPE */}
      <div className={cx(styles.toolbarSection, styles.insertShape)}>
        <CustomSelect
          value=""
          placeholder="Insert Shape"
          options={Object.entries(PRESET_SHAPES).map(([key, { label }]) => ({
            value: key,
            label,
          }))}
          onChange={({ value }) => insertPresetShape(value)}
          baseColor={isDarkMode && appColors.black}
        />
      </div>

      {/* IMPORT IMAGE */}
      <div className={cx(styles.toolbarSection, styles.importImage)}>
        <Tooltip title="Import reference image(s) (PNG, GIF, JPEG)">
          <div>
            <Button
              hasBorder
              color={grayLightest}
              onClick={() => fileInputRef.current.click()}
            >
              <PictureOutlined />
            </Button>
          </div>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/gif,image/jpeg"
          multiple
          style={{ display: 'none' }}
          onChange={handleImageFileChange}
        />
        <Tooltip title="Import MIDI file as shapes">
          <div>
            <Button
              hasBorder
              color={grayLightest}
              onClick={() => midiFileInputRef.current.click()}
            >
              <ImportOutlined />
            </Button>
          </div>
        </Tooltip>
        <input
          ref={midiFileInputRef}
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          style={{ display: 'none' }}
          onChange={handleMidiFileChange}
        />
      </div>

      {/* IMPORT GPS/GIS FILE (geographic mode only) - its own section
          rather than a 3rd item crammed into .importImage, which is a
          fixed 2-column grid sized for exactly the two buttons above; a
          3rd grid item there wraps into an implicit row below the
          toolbar's fixed 50px height, clipped out of view. */}
      {canvasMode === CANVAS_MODES.GEOGRAPHIC && (
        <div className={cx(styles.toolbarSection, styles.importGeo)}>
          <Tooltip title="Import a GPS/GIS file (GPX/KML/GeoJSON/Shapefile) as shape(s)">
            <div>
              <Button
                hasBorder
                color={grayLightest}
                onClick={() => geoFileInputRef.current.click()}
              >
                <GlobalOutlined />
              </Button>
            </div>
          </Tooltip>
          <input
            ref={geoFileInputRef}
            type="file"
            accept=".gpx,.kml,.geojson,.json,.shp,.zip"
            style={{ display: 'none' }}
            onChange={handleGeoFileChange}
          />
        </div>
      )}

      {geoImportModePrompt && (
        <GeoImportModeModal
          sourceLabel={geoImportModePrompt.sourceLabel}
          featureCount={geoImportModePrompt.featureCount}
          onConfirm={mode => {
            importModeResolverRef.current({ cancelled: false, mode });
            setGeoImportModePrompt(null);
          }}
          onCancel={() => {
            importModeResolverRef.current({ cancelled: true });
            setGeoImportModePrompt(null);
          }}
        />
      )}

      {geoImportLog && (
        <GeoImportLogModal
          sourceLabel={geoImportLog.sourceLabel}
          entries={geoImportLog.entries}
          status={geoImportLog.status}
          onConfirm={() => setGeoImportLog(null)}
        />
      )}

      {geoSimplifyReview && (
        <GeoSimplifyPreviewModal
          tracks={geoSimplifyReview.tracks}
          denseTrackCount={geoSimplifyReview.denseTrackCount}
          minRatio={geoSimplifyReview.minRatio}
          maxRatio={geoSimplifyReview.maxRatio}
          onConfirm={ratio => {
            simplifyResolverRef.current({ cancelled: false, ratio });
            setGeoSimplifyReview(null);
          }}
          onCancel={() => {
            simplifyResolverRef.current({ cancelled: true });
            setGeoSimplifyReview(null);
          }}
        />
      )}

      {/* CANVAS CONTROLS */}
      <div
        className={styles.canvasControls}
        style={{
          display: 'grid',
          gridTemplateColumns: '80px 80px 1fr',
          gridGap: 3,
        }}
      >
        <div
          // className={cx(styles.toolbarSection)}
          style={{
            borderRadius: 3,
            padding: 0,
            border: !isDarkMode && `1px solid ${lightGray}`,
            // background: lightGray,
            gridGap: 1,
            overflow: 'hidden',
            height: '100%',
          }}
        >
          <CheckboxButton
            checked={isGridActive}
            onChange={() => {
              dispatch({ type: PROJECT_ACTIONS.TOGGLE_GRID });
              dispatch({ type: PROJECT_ACTIONS.TOGGLE_SNAP_TO_GRID });
            }}
            label={'Grid'}
            color={isDarkMode && appColors.black}
          />
          {/*  <div>
            <CheckboxButton
              checked={isSnapToGridActive}
              onChange={() => {
                dispatch({ type: PROJECT_ACTIONS.TOGGLE_SNAP_TO_GRID });
              }}
              label={'Snap'}
            />
          </div> */}
        </div>

        <Tooltip title="Sync shape perimeter lengths">
          <div
            style={{
              borderRadius: 3,
              padding: 0,
              border: !isDarkMode && `1px solid ${lightGray}`,
              // background: lightGray,
              gridGap: 1,
              overflow: 'hidden',
            }}
          >
            <CheckboxButton
              checked={isAutoQuantizeActive}
              onChange={() => {
                dispatch({ type: PROJECT_ACTIONS.TOGGLE_AUTO_QUANTIZE });
              }}
              label={'Sync'}
              color={isDarkMode && appColors.black}
            />
          </div>
        </Tooltip>
        <div
          style={{
            borderRadius: 3,
            padding: 0,
            border: !isDarkMode && `1px solid ${lightGray}`,
            // background: lightGray,
            gridGap: 1,
            overflow: 'hidden',
          }}
        >
          <CheckboxButton
            checked={isProximityModeActive}
            onChange={() => {
              dispatch({ type: PROJECT_ACTIONS.TOGGLE_PROXIMITY_MODE });
            }}
            labelStyle={{ fontSize: '0.9em' }}
            label={'Proximity Mode'}
            renderLabel={label => (
              <div
                style={{
                  // minWidth: 120,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Tooltip title="Use the mouse position to listen to shapes">
                  {label}
                </Tooltip>

                <Popover
                  placement="bottomRight"
                  arrowPointAtCenter
                  className="proximityRadiusPopover"
                  content={() => (
                    <div
                      style={{
                        borderRadius: 2,
                        overflow: 'hidden',
                        border: `1px solid ${white}`,
                        width: 120,
                        height: 30,
                      }}
                    >
                      <CustomSlider
                        min={MIN_PROXIMITY_RADIUS}
                        max={MAX_PROXIMITY_RADIUS}
                        color="#eee"
                        vertical={false}
                        value={proximityModeRadius}
                        defaultValue={PROXIMITY_MODE_RADIUS}
                        onChange={val => {
                          dispatch({
                            type: PROJECT_ACTIONS.SET_PROXIMITY_MODE_RADIUS,
                            payload: val,
                          });
                        }}
                        label={<span style={{ color: 'initial' }}>Radius</span>}
                      />
                    </div>
                  )}
                >
                  <div style={{ paddingLeft: 5 }}>
                    <i className="ion-chevron-down" />
                  </div>
                </Popover>
              </div>
            )}
            color={isDarkMode && appColors.black}
          />
        </div>
        {/*  */}
      </div>

      <div className={cx(styles.toolbarSection, styles.tempo)}>
        <TempoInput
          onChange={val => {
            dispatch({ type: PROJECT_ACTIONS.SET_TEMPO, payload: val });
          }}
          value={tempo}
        />
      </div>
      {/* MUSICAL CONTROLS */}
      <div className={cx(styles.toolbarSection, styles.musicalControls)}>
        <CustomSelect
          value={scaleObj.tonic.toString(true)}
          options={TONICS}
          onChange={({ value }) => {
            dispatch({ type: PROJECT_ACTIONS.SET_TONIC, payload: value });
          }}
          title="Key Root"
          baseColor={isDarkMode && appColors.black}
        />
        <CustomSelect
          value={scaleObj.name}
          options={SCALES}
          onChange={({ value }) => {
            dispatch({ type: PROJECT_ACTIONS.SET_MODE, payload: value });
          }}
          title="Key Mode"
          baseColor={isDarkMode && appColors.black}
        />
      </div>

      {/* OTHER */}
      <div className={cx(styles.toolbarSection, styles.OtherControls)}>
        <div>
          <Popconfirm
            title="Clear Canvas? (cannot be undone)"
            placement="bottom"
            okText="Clear"
            cancelText="Cancel"
            okType="danger"
            onConfirm={() => {
              clearProjectCanvas();
              dispatch({ type: PROJECT_ACTIONS.CLEAR_ALL_REFERENCE_IMAGES });
            }}
            icon={<QuestionCircleOutlined />}
          >
            <Button
              hasBorder
              color={grayLightest}
              // onClick={clearProjectCanvas}
            >
              Clear
            </Button>
          </Popconfirm>
        </div>
        <div>
          <Tooltip title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
            <div>
              <Button
                hasBorder
                color={grayLightest}
                onClick={() => setTheme(isDarkMode ? THEMES.LIGHT : THEMES.DARK)}
              >
                {isDarkMode ? <BulbOutlined /> : <BulbFilled />}
              </Button>
            </div>
          </Tooltip>
        </div>
        {/* TODO: re-enable if fullscreen bug is fixed (ShapeEditorPopover not appearing in fullscreen) */}
        {/* <div>
        <IconButton
          iconClassName={fullscreenButtonClass}
          onClick={handleFullscreenButtonClick}
          title="Toggle Fullscreen"
        />
      </div> */}
      </div>
    </div>
  );
}

export default ToolbarComponent;
