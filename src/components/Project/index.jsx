import React, { useState, useRef, useReducer, useEffect } from 'react';
import Teoria from 'teoria';
import { HotKeys } from 'react-hotkeys';
import { isEqual } from 'lodash';
import Toolbar from 'components/Toolbar';
import Sidebar from 'components/Sidebar';
import FileNameBadge from 'components/FileNameBadge';
import CanvasModeToggle from 'components/CanvasModeToggle';
import ShapeCanvas from 'components/ShapeCanvas';
import ColorControllerPanel from 'components/ColorControllerPanel';
import Spectrometer from 'components/Spectrometer';
import PlayBar from 'components/PlayBar';

import { themeColors } from 'utils/color';
import { convertAndDownloadTracksAsMIDI, saveFileAs } from 'utils/file';
import { buildLineArtSVG } from 'utils/svgExport';
import { showErrorMessage } from 'utils/message';

import { keyMap } from './keyMap';
import ProjectContextProvider from './ProjectContextProvider';
import { getDefaultParamValues, DEFAULT_SYNTHS } from 'utils/synths';
import styles from './styles.module.css';
import { useRecorder } from './useRecorder';
import { useAudioOutput } from './useAudioOutput';
import {
  PROJECT_ACTIONS,
  TOOL_TYPES,
  getInitState,
  MIN_PROXIMITY_RADIUS,
  MAX_PROXIMITY_RADIUS,
} from 'utils/project';
import useUnload from 'hooks/useUnload';

export default props => {
  const {
    initState,
    showSaveButton,
    showSettingsButton,
    projectAuthor,
    deleteProject: deleteProjectMutation,
    saveProject: saveProjectMutation,
  } = props;

  const shapeCanvas = useRef(null);
  const [isAltPressed, setIsAltPressed] = useState(false);

  const projectReducer = (state, action) => {
    if (!action.type) {
      throw new Error(`No action type`);
    }
    switch (action.type) {
      case PROJECT_ACTIONS.SET_ACTIVE_TOOL:
        if (shapeCanvas && shapeCanvas.current.canChangeTool()) {
          return {
            ...state,
            activeTool: action.payload,
          };
        } else {
          return state;
        }
      case PROJECT_ACTIONS.TOGGLE_ACTIVE_TOOL:
        if (shapeCanvas && shapeCanvas.current.canChangeTool()) {
          return {
            ...state,
            activeTool:
              state.activeTool === TOOL_TYPES.DRAW
                ? TOOL_TYPES.EDIT
                : TOOL_TYPES.DRAW,
          };
        } else {
          return state;
        }
      case PROJECT_ACTIONS.CHANGE_DRAW_COLOR: {
        // digit N selects the Nth *active* instrument (ordinal position in
        // activeColorIndices), not raw colorIndex N-1 - with a short,
        // possibly sparse active list, that's far more useful than
        // silently no-op'ing whenever colorIndex N-1 happens to be inactive
        const position = parseInt(action.payload, 10) - 1;
        const colorIndex = state.activeColorIndices[position];
        if (colorIndex === undefined) return state;
        return {
          ...state,
          activeTool: TOOL_TYPES.DRAW,
          activeColorIndex: colorIndex,
        };
      }
      case PROJECT_ACTIONS.SET_DRAW_COLOR:
        return {
          ...state,
          activeTool: TOOL_TYPES.DRAW,
          activeColorIndex: themeColors.indexOf(action.payload),
        };
      case PROJECT_ACTIONS.TOGGLE_GRID:
        return {
          ...state,
          isGridActive: !state.isGridActive,
        };
      case PROJECT_ACTIONS.TOGGLE_SNAP_TO_GRID:
        return {
          ...state,
          isSnapToGridActive: !state.isSnapToGridActive,
        };
      case PROJECT_ACTIONS.TOGGLE_AUTO_QUANTIZE:
        return {
          ...state,
          isAutoQuantizeActive: !state.isAutoQuantizeActive,
        };
      case PROJECT_ACTIONS.TOGGLE_PROXIMITY_MODE:
        return {
          ...state,
          isProximityModeActive: !state.isProximityModeActive,
        };
      case PROJECT_ACTIONS.SET_PROXIMITY_MODE_RADIUS: {
        const proximityModeRadius = Math.max(
          Math.min(action.payload, MAX_PROXIMITY_RADIUS),
          MIN_PROXIMITY_RADIUS
        );
        return { ...state, proximityModeRadius };
      }
      case PROJECT_ACTIONS.SET_PROJECT_NAME:
        return { ...state, projectName: action.payload };
      case PROJECT_ACTIONS.SET_TEMPO: {
        const min = 1;
        const max = 100;
        const tempo = Math.max(Math.min(action.payload, max), min);
        return { ...state, tempo };
      }
      case PROJECT_ACTIONS.SET_TONIC:
        return {
          ...state,
          scaleObj: Teoria.note(action.payload).scale(state.scaleObj.name),
        };
      case PROJECT_ACTIONS.SET_MODE:
        if (!action.payload) return state;
        const {
          scaleObj: { tonic },
        } = state;
        return {
          ...state,
          scaleObj: tonic.scale(action.payload),
        };
      case PROJECT_ACTIONS.SET_CANVAS_MODE:
        return { ...state, canvasMode: action.payload };
      case PROJECT_ACTIONS.SET_INSTRUMENT_FOR_COLOR: {
        const { colorIndex, instrumentName } = action.payload;
        const newSelectedSynths = state.selectedSynths.slice();
        const defaultKnobvals = getDefaultParamValues(instrumentName);
        const knobVals = state.knobVals.slice();
        newSelectedSynths[colorIndex] = instrumentName;
        knobVals[colorIndex] = defaultKnobvals;
        return {
          ...state,
          selectedSynths: newSelectedSynths,
          knobVals,
        };
      }
      case PROJECT_ACTIONS.ADD_INSTRUMENT_CHANNEL: {
        if (state.activeColorIndices.length >= themeColors.length) return state;
        const nextColorIndex = themeColors.findIndex(
          (_, i) => !state.activeColorIndices.includes(i)
        );
        return {
          ...state,
          activeColorIndices: [...state.activeColorIndices, nextColorIndex],
        };
      }
      case PROJECT_ACTIONS.REMOVE_INSTRUMENT_CHANNEL: {
        const { colorIndex } = action.payload;
        // always keep at least one active - there must always be a valid
        // color to draw with
        if (state.activeColorIndices.length <= 1) return state;
        const activeColorIndices = state.activeColorIndices.filter(
          i => i !== colorIndex
        );
        return {
          ...state,
          activeColorIndices,
          activeColorIndex:
            state.activeColorIndex === colorIndex
              ? activeColorIndices[0]
              : state.activeColorIndex,
        };
      }
      case PROJECT_ACTIONS.ASSIGN_INSTRUMENT_CHANNELS: {
        // payload: [{ colorIndex, instrumentName }] - utils/midiImport.js's
        // assignMidiImportChannels decides which channels a MIDI import's
        // tracks should claim; this just applies that decision atomically
        // (activate the channel + set its instrument in one dispatch),
        // same per-channel update SET_INSTRUMENT_FOR_COLOR does for one
        // channel at a time.
        const assignments = action.payload;
        if (!assignments.length) return state;
        const activeColorIndices = Array.from(
          new Set([...state.activeColorIndices, ...assignments.map(a => a.colorIndex)])
        );
        const selectedSynths = state.selectedSynths.slice();
        const knobVals = state.knobVals.slice();
        assignments.forEach(({ colorIndex, instrumentName }) => {
          selectedSynths[colorIndex] = instrumentName;
          knobVals[colorIndex] = getDefaultParamValues(instrumentName);
        });
        return {
          ...state,
          activeColorIndices,
          selectedSynths,
          knobVals,
        };
      }
      case PROJECT_ACTIONS.REPLACE_INSTRUMENT_CHANNELS: {
        // Importing a MIDI file now clears the canvas first (Toolbar's
        // handleMidiFileChange), so the footer should show exactly the
        // instruments that new import actually uses - not those PLUS
        // whatever was active before, which is what ASSIGN_INSTRUMENT_
        // CHANNELS (above) does for the non-clearing case of importing
        // into an already-populated canvas. assignMidiImportChannels is
        // called with an empty activeColorIndices for this path, so every
        // distinct program in the file already gets its own fresh entry
        // in `assignments` here (channels 0, 1, 2... in file order) -
        // this just applies that as a full replacement instead of a merge.
        const assignments = action.payload;
        if (!assignments.length) return state;
        const activeColorIndices = Array.from(
          new Set(assignments.map(a => a.colorIndex))
        );
        const selectedSynths = state.selectedSynths.slice();
        const knobVals = state.knobVals.slice();
        assignments.forEach(({ colorIndex, instrumentName }) => {
          selectedSynths[colorIndex] = instrumentName;
          knobVals[colorIndex] = getDefaultParamValues(instrumentName);
        });
        return {
          ...state,
          activeColorIndices,
          selectedSynths,
          knobVals,
          activeColorIndex: activeColorIndices[0],
        };
      }
      case PROJECT_ACTIONS.RESET_INSTRUMENTS: {
        // Clearing the canvas (Toolbar's Clear button, and now MIDI
        // import's own clear-first behavior) also resets the instrument
        // footer back to just the one default (Grand Piano) - without
        // this, every channel a prior MIDI import or manual "+" add ever
        // claimed stays active forever, so repeatedly clearing and
        // re-importing/re-drawing only ever adds SF2 instrument channels
        // and never removes any, eventually filling the whole 16-slot
        // footer with leftovers nothing on the (now-empty) canvas uses.
        return {
          ...state,
          activeColorIndices: [0],
          activeColorIndex: 0,
          selectedSynths: DEFAULT_SYNTHS,
          knobVals: DEFAULT_SYNTHS.map(getDefaultParamValues),
        };
      }
      case PROJECT_ACTIONS.REASSIGN_INSTRUMENT_COLOR: {
        const { oldColorIndex, newColorIndex } = action.payload;
        // target must be a currently-inactive color - swapping with
        // another active instrument isn't supported (keeps this a simple
        // 1:1 move rather than needing a double-swap); the UI
        // (ColorController's color-swatch picker) only ever offers
        // inactive colors as targets, but guard here too
        if (
          oldColorIndex === newColorIndex ||
          state.activeColorIndices.includes(newColorIndex)
        ) {
          return state;
        }
        const newSelectedSynths = state.selectedSynths.slice();
        const newKnobVals = state.knobVals.slice();
        newSelectedSynths[newColorIndex] = state.selectedSynths[oldColorIndex];
        newKnobVals[newColorIndex] = state.knobVals[oldColorIndex];
        return {
          ...state,
          selectedSynths: newSelectedSynths,
          knobVals: newKnobVals,
          // replace at the same position so footer order (and the
          // digit-key ordinal mapping) doesn't jump around
          activeColorIndices: state.activeColorIndices.map(i =>
            i === oldColorIndex ? newColorIndex : i
          ),
          activeColorIndex:
            state.activeColorIndex === oldColorIndex
              ? newColorIndex
              : state.activeColorIndex,
        };
      }
      case PROJECT_ACTIONS.ADD_REFERENCE_IMAGE:
        return {
          ...state,
          referenceImages: [...state.referenceImages, action.payload],
          selectedReferenceImageId: null,
        };
      case PROJECT_ACTIONS.UPDATE_REFERENCE_IMAGE_TRANSFORM:
        return {
          ...state,
          referenceImages: state.referenceImages.map(img =>
            img.id === action.payload.id ? { ...img, ...action.payload } : img
          ),
        };
      case PROJECT_ACTIONS.REMOVE_REFERENCE_IMAGE:
        return {
          ...state,
          referenceImages: state.referenceImages.filter(
            img => img.id !== action.payload
          ),
          selectedReferenceImageId:
            state.selectedReferenceImageId === action.payload
              ? null
              : state.selectedReferenceImageId,
        };
      case PROJECT_ACTIONS.CLEAR_ALL_REFERENCE_IMAGES:
        return {
          ...state,
          referenceImages: [],
          selectedReferenceImageId: null,
        };
      case PROJECT_ACTIONS.SET_SELECTED_REFERENCE_IMAGE:
        return {
          ...state,
          selectedReferenceImageId: action.payload,
        };
      case PROJECT_ACTIONS.SET_KNOB_VALUE_FOR_COLOR: {
        const {
          payload: { colorIndex, effectIndex, value },
        } = action;
        const knobVals = state.knobVals.slice();
        const colorKnobVals = knobVals[colorIndex].slice();
        colorKnobVals[effectIndex] = value;
        knobVals[colorIndex] = colorKnobVals;
        return {
          ...state,
          knobVals,
        };
      }
      default:
        throw new Error(`Unknown action type ${action.type}`);
    }
  };

  const [state, dispatch] = useReducer(projectReducer, getInitState(initState));

  const { projectName, tempo } = state;

  // "May lose unsaved changes" message
  useUnload(e => {
    console.log('Unloading');
    const projectData = state;
    const shapesList = shapeCanvas.current.getShapesList();
    const currentState = {
      ...projectData,
      shapesList,
    };

    console.log('initState');
    console.log(getInitState(initState));
    console.log('currentState');
    console.log(currentState);

    const hasShapes = shapeCanvas.current.getShapesList().length > 0;
    const statesAreEqual = isEqual(
      { ...getInitState(initState), shapesList: initState.shapesList },
      currentState
    );

    // prevent unload if user can save, there are shapes drawn, and the current state is different from the initial state
    if (showSaveButton && hasShapes && !statesAreEqual) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const {
    isArmed,
    isRecording,
    beginRecording,
    stopRecording,
    armRecording,
    downloadUrls,
  } = useRecorder();

  const { isPlaying, toggleIsPlaying, stop, resetPosition } = useAudioOutput({
    isArmed,
    isRecording,
    beginRecording,
    stopRecording,
  });

  const togglePlayStop = () => {
    toggleIsPlaying();
    if (isArmed) {
      beginRecording();
    }
    if (isRecording) {
      stopRecording();
    }
  };

  // Genuinely distinct from togglePlayStop above (which, despite its name,
  // pauses - see useAudioOutput's own toggleIsPlaying) - this is the real
  // reset-to-0 action, PlayBar's separate Stop button. Also finalizes a
  // recording in progress, same as pausing already does, rather than
  // leaving it dangling.
  const stopPlayback = () => {
    stop();
    if (isRecording) {
      stopRecording();
    }
  };

  const toggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      if (isPlaying) {
        beginRecording();
      } else {
        armRecording();
      }
    }
  };

  const clearProjectCanvas = () => {
    if (shapeCanvas) {
      shapeCanvas.current.clearAll();
    }
    // Resets the playhead along with everything else - otherwise, if
    // playback was never paused/stopped, whatever gets drawn/imported
    // next mounts against a Transport position that's already mid-piece,
    // which (see useAudioOutput's resetPosition comment) makes the new
    // content start somewhere mid-loop rather than at its own beginning.
    resetPosition();
    dispatch({ type: PROJECT_ACTIONS.RESET_INSTRUMENTS });
    // initState.projectName is whatever name was actually persisted when
    // this project last loaded (blank for a brand new one) - the only way
    // state.projectName ever diverges from it mid-session today is a MIDI
    // import setting a working name that's never been saved (saveProject
    // hands off to an external mutation and doesn't write back into this
    // reducer at all). So resetting to initState.projectName here either
    // restores a genuinely saved project's real name, or - when that was
    // blank to begin with - clears an imported-but-unsaved name back to
    // "Untitled Project" (FileNameBadge's own fallback) right along with
    // the canvas it described.
    dispatch({
      type: PROJECT_ACTIONS.SET_PROJECT_NAME,
      payload: initState.projectName,
    });
  };

  const insertPresetShape = shapeType => {
    if (shapeCanvas) {
      shapeCanvas.current.insertPresetShape(shapeType);
    }
  };

  const importMidiShapes = (
    pointsLists,
    noteEventsLists,
    colorIndexForTrack,
    startTimes,
    loopDuration
  ) => {
    if (shapeCanvas) {
      shapeCanvas.current.importMidiShapes(
        pointsLists,
        noteEventsLists,
        colorIndexForTrack,
        startTimes,
        loopDuration
      );
    }
  };

  const importGeoShapes = (pointsLists, colorIndexForTrack, sourceLabel) => {
    if (shapeCanvas) {
      shapeCanvas.current.importGeoShapes(pointsLists, colorIndexForTrack, sourceLabel);
    }
  };

  const reassignInstrumentColor = (oldColorIndex, newColorIndex) => {
    if (shapeCanvas) {
      // move any existing shapes over first, then swap the
      // instrument/color bookkeeping itself
      shapeCanvas.current.recolorAllShapesWithColor(oldColorIndex, newColorIndex);
    }
    dispatch({
      type: PROJECT_ACTIONS.REASSIGN_INSTRUMENT_COLOR,
      payload: { oldColorIndex, newColorIndex },
    });
  };

  const exportProjectToMIDI = async () => {
    // get list of MIDI events from the shape canvas
    const shapeNoteEventsList = shapeCanvas.current.getShapeMIDINoteEvents();
    await convertAndDownloadTracksAsMIDI({
      tempo,
      shapeNoteEventsList,
      projectName,
    });
  };

  const exportLineArt = async () => {
    // same live/absolute point data saveProject and exportProjectToMIDI
    // already pull from - current drag positions, not whatever the
    // shapesList React state happened to hold last render
    const shapesList = shapeCanvas.current.getShapesList();
    const svg = buildLineArtSVG(shapesList);
    if (!svg) {
      showErrorMessage('No visible shapes to export');
      return;
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    await saveFileAs(blob, `${projectName || 'The Shape of Music Project'} - line art.svg`, 'image/svg+xml');
  };

  const exportToMp3 = () => {
    // calling these two setters directly (rather than the togglePlayStop/
    // toggleRecord wrappers) avoids a stale-closure ordering bug: those
    // wrappers each read isArmed/isPlaying from this render's closure, so
    // arming-then-playing in one click wouldn't actually start recording
    // until a render later. toggleIsPlaying/beginRecording have no such
    // interdependency, so calling both here works immediately.
    if (!isPlaying) {
      toggleIsPlaying();
    }
    beginRecording();
  };

  const saveProject = projectName => {
    if (!projectName) return;
    console.log('Saving project with name', projectName);

    const projectData = state;
    const shapesList = shapeCanvas.current.getShapesList();

    saveProjectMutation({
      ...projectData,
      name: projectName,
      shapesList,
    });
  };

  const projectContext = {
    ...state,
    isAltPressed,
    isRecording,
    isArmed,
    isPlaying,
    downloadUrls,
    dispatch,
    imperativeHandlers: {
      togglePlayStop,
      stopPlayback,
      resetPlaybackPosition: resetPosition,
      toggleRecord,
      clearProjectCanvas,
      insertPresetShape,
      importMidiShapes,
      importGeoShapes,
      reassignInstrumentColor,
      exportProjectToMIDI,
      exportLineArt,
      exportToMp3,
      saveProject,
      deleteProject: deleteProjectMutation,
    },
  };

  // Game-style continuous panning: track which directions are currently
  // held (native keydown/keyup, see the effect below) and advance stagePos
  // every animation frame for as long as any are held, rather than
  // reacting once per discrete keypress. Holding two perpendicular keys
  // (e.g. W+D) pans diagonally for free, since both directions are summed
  // each frame.
  const panKeysRef = useRef({ up: false, down: false, left: false, right: false });
  const panAnimationFrameRef = useRef(null);
  const PAN_SPEED = 700; // screen pixels/sec - same units stagePos already uses

  const startPanLoop = () => {
    if (panAnimationFrameRef.current !== null) return; // already running
    let lastTime = performance.now();
    const loop = now => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const keys = panKeysRef.current;
      if (!keys.up && !keys.down && !keys.left && !keys.right) {
        panAnimationFrameRef.current = null;
        return;
      }
      const dxDir = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      const dyDir = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      if ((dxDir || dyDir) && shapeCanvas.current) {
        shapeCanvas.current.panByKeyboard(dxDir * PAN_SPEED * dt, dyDir * PAN_SPEED * dt);
      }
      panAnimationFrameRef.current = requestAnimationFrame(loop);
    };
    panAnimationFrameRef.current = requestAnimationFrame(loop);
  };

  // Same approach for Z/Q zoom in/out - hold to zoom continuously instead
  // of one fixed step per keypress.
  const zoomKeysRef = useRef({ in: false, out: false });
  const zoomAnimationFrameRef = useRef(null);

  const startZoomLoop = () => {
    if (zoomAnimationFrameRef.current !== null) return;
    let lastTime = performance.now();
    const loop = now => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const keys = zoomKeysRef.current;
      if (!keys.in && !keys.out) {
        zoomAnimationFrameRef.current = null;
        return;
      }
      if (shapeCanvas.current) {
        if (keys.in) shapeCanvas.current.zoomByStep(1, dt);
        if (keys.out) shapeCanvas.current.zoomByStep(-1, dt);
      }
      zoomAnimationFrameRef.current = requestAnimationFrame(loop);
    };
    zoomAnimationFrameRef.current = requestAnimationFrame(loop);
  };

  // Native keydown/keyup listeners, deliberately NOT routed through
  // react-hotkeys: that library defaults to
  // ignoreRepeatedEventsWhenKeyHeldDown (its Configuration.js) and its
  // internal sequence/repeat resolution is built around discrete hotkey
  // actions, not raw held-key state - using it for continuous movement
  // caused a visible debounce-like glitch (a brief wrong-direction blip)
  // on direction changes. Raw listeners give direct, predictable key state
  // with no library resolution logic in the way - the standard approach
  // for this kind of input anyway.
  useEffect(() => {
    const PAN_KEYS = {
      arrowup: 'up',
      w: 'up',
      arrowdown: 'down',
      s: 'down',
      arrowleft: 'left',
      a: 'left',
      arrowright: 'right',
      d: 'right',
    };
    const ZOOM_KEYS = { z: 'in', q: 'out' };
    const isTypingTarget = target =>
      target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    const handleKeyDown = e => {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (PAN_KEYS[key]) {
        e.preventDefault();
        panKeysRef.current[PAN_KEYS[key]] = true;
        startPanLoop();
      } else if (ZOOM_KEYS[key]) {
        e.preventDefault();
        zoomKeysRef.current[ZOOM_KEYS[key]] = true;
        startZoomLoop();
      }
    };

    const handleKeyUp = e => {
      const key = e.key.toLowerCase();
      if (PAN_KEYS[key]) {
        panKeysRef.current[PAN_KEYS[key]] = false;
      } else if (ZOOM_KEYS[key]) {
        zoomKeysRef.current[ZOOM_KEYS[key]] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (panAnimationFrameRef.current !== null) {
        cancelAnimationFrame(panAnimationFrameRef.current);
      }
      if (zoomAnimationFrameRef.current !== null) {
        cancelAnimationFrame(zoomAnimationFrameRef.current);
      }
    };
  }, []);

  const keyHandlers = {
    PLAY: e => {
      e.preventDefault();
      e.stopPropagation();
      togglePlayStop();
    },
    TOGGLE_ACTIVE_TOOL: e => {
      e.preventDefault();
      e.stopPropagation();
      dispatch({
        type: PROJECT_ACTIONS.TOGGLE_ACTIVE_TOOL,
      });
    },
    CHANGE_DRAW_COLOR: ({ key }) => {
      dispatch({
        type: PROJECT_ACTIONS.CHANGE_DRAW_COLOR,
        payload: key,
      });
    },
    ALT_DOWN: () => setIsAltPressed(true),
    ALT_UP: () => setIsAltPressed(false),
    DELETE_SHAPE: e => {
      e.preventDefault();
      e.stopPropagation();
      // TODO move into separate shape canvas hotkeys wrapper
      shapeCanvas.current.deleteSelectedShape();
    },
    CANCEL_IN_PROGRESS_SHAPE: () => {
      // TODO move into separate shape canvas hotkeys wrapper
      shapeCanvas.current.cancelInProgressShape();
    },
  };

  return (
    <HotKeys allowChanges keyMap={keyMap} handlers={keyHandlers}>
      <ProjectContextProvider value={projectContext}>
        {projectAuthor && projectName && (
          <div className={styles.ProjectTitle}>
            <strong>{projectName}</strong> by <em>{projectAuthor.name}</em>
          </div>
        )}

        {/* The Controls */}
        <Toolbar />

        {/* What's currently open - imported file's name, saved project
            name, or an "Untitled" fallback; always visible, unlike
            ProjectTitle above which only shows for a saved+attributed
            project */}
        <FileNameBadge />

        {/* The Canvas */}
        <ShapeCanvas
          // TODO: revisit: do we need to do this?
          onMount={e => {
            shapeCanvas.current = e;
          }}
          initShapesList={initState.shapesList}
        />

        {/* Instrument controller panels */}
        <ColorControllerPanel />

        {/* Frequency visualization */}
        <Spectrometer />

        {/* Seekable track progress - just above the Spectrometer */}
        <PlayBar />

        {/* Sidebar */}
        <Sidebar
          showSaveButton={showSaveButton}
          showSettingsButton={showSettingsButton}
        />

        {/* Musical canvas / geographic mode switch */}
        <CanvasModeToggle />
      </ProjectContextProvider>
    </HotKeys>
  );
};
