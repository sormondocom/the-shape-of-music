import React, { useRef } from 'react';
import cx from 'classnames';
import { Popconfirm, Popover, Tooltip } from 'antd';

import Button from 'components/Button';
import CheckboxButton from 'components/CheckboxButton';
import CustomSelect from 'components/CustomSelect';
import TempoInput from 'components/TempoInput';

import DrawToolIcon from 'components/icons/DrawTool';
import EditToolIcon from 'components/icons/EditTool';
import { appColors, getDarker, THEMES } from 'utils/color';
import { Midi } from '@tonejs/midi';
import { PRESET_SHAPES } from 'utils/shape';
import { convertMidiTrackToPoints, assignMidiImportChannels } from 'utils/midiImport';
import { convertGeoFileToShapes, toPoints as geoTrackToPoints } from 'utils/geoTrackImport';
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

    // Working name becomes the imported file's own full name, extension
    // included - the browser never gives a page the file's actual
    // filesystem path (sandboxed by design, same for the File System
    // Access API), so the complete filename is the most complete thing
    // actually available here. The canvas is being fully replaced with
    // this file's content, so the project's working identity should
    // track it too, not keep whatever name (or lack of one) the project
    // had before. FileNameBadge is what actually surfaces this on screen.
    dispatch({
      type: PROJECT_ACTIONS.SET_PROJECT_NAME,
      payload: file.name,
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

    let shapes;
    try {
      const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
      if (extension === 'shp' || extension === 'zip') {
        const tracks = await parseShapefile(file);
        shapes = tracks
          .filter(track => track.length >= 2)
          .map(track => ({ points: geoTrackToPoints(track) }));
      } else {
        const text = await file.text();
        shapes = convertGeoFileToShapes(text, extension);
      }
    } catch (err) {
      showErrorMessage(`Could not read that file: ${err.message}`);
      return;
    }

    if (!shapes.length) {
      showErrorMessage('No usable shapes found in that file');
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

    importGeoShapes(shapes.map(s => s.points), colorIndexForTrack, file.name);
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
