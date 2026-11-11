import { DEFAULT_SYNTHS } from './synths';
import { getDefaultParamValues } from 'utils/synths';
import Teoria from 'teoria';

export const DEFAULT_PROXIMITY_MODE_RADIUS = 400;
export const MIN_PROXIMITY_RADIUS = 50;
export const MAX_PROXIMITY_RADIUS = 900;

export const LAYERS_PANEL_WIDTH = 280;
export const getCanvasWidth = () => window.innerWidth - LAYERS_PANEL_WIDTH;

export const TOOL_TYPES = {
  EDIT: 'edit',
  DRAW: 'draw',
};

// Musical (the default, always-existing canvas) vs geographic (GPS-track
// import - utils/geoTrackImport.js - gated UI, and later a georeferenced
// map reference layer). Toggled via components/CanvasModeToggle.
export const CANVAS_MODES = {
  MUSICAL: 'musical',
  GEOGRAPHIC: 'geographic',
};

export const PROJECT_ACTIONS = {
  SET_ACTIVE_TOOL: 'SET_ACTIVE_TOOL',
  TOGGLE_ACTIVE_TOOL: 'TOGGLE_ACTIVE_TOOL',
  CHANGE_DRAW_COLOR: 'CHANGE_DRAW_COLOR',
  SET_DRAW_COLOR: 'SET_DRAW_COLOR',
  TOGGLE_GRID: 'TOGGLE_GRID',
  TOGGLE_SNAP_TO_GRID: 'TOGGLE_SNAP_TO_GRID',
  TOGGLE_AUTO_QUANTIZE: 'TOGGLE_AUTO_QUANTIZE',
  TOGGLE_PROXIMITY_MODE: 'TOGGLE_PROXIMITY_MODE',
  SET_PROXIMITY_MODE_RADIUS: 'SET_PROXIMITY_MODE_RADIUS',
  SET_PROJECT_NAME: 'SET_PROJECT_NAME',
  SET_TEMPO: 'SET_TEMPO',
  SET_TONIC: 'SET_TONIC',
  SET_MODE: 'SET_MODE',
  SET_CANVAS_MODE: 'SET_CANVAS_MODE',
  SET_INSTRUMENT_FOR_COLOR: 'SET_INSTRUMENT_FOR_COLOR',
  SET_KNOB_VALUE_FOR_COLOR: 'SET_KNOB_VALUE_FOR_COLOR',
  ADD_INSTRUMENT_CHANNEL: 'ADD_INSTRUMENT_CHANNEL',
  REMOVE_INSTRUMENT_CHANNEL: 'REMOVE_INSTRUMENT_CHANNEL',
  REASSIGN_INSTRUMENT_COLOR: 'REASSIGN_INSTRUMENT_COLOR',
  ASSIGN_INSTRUMENT_CHANNELS: 'ASSIGN_INSTRUMENT_CHANNELS',
  REPLACE_INSTRUMENT_CHANNELS: 'REPLACE_INSTRUMENT_CHANNELS',
  RESET_INSTRUMENTS: 'RESET_INSTRUMENTS',
  ADD_REFERENCE_IMAGE: 'ADD_REFERENCE_IMAGE',
  UPDATE_REFERENCE_IMAGE_TRANSFORM: 'UPDATE_REFERENCE_IMAGE_TRANSFORM',
  REMOVE_REFERENCE_IMAGE: 'REMOVE_REFERENCE_IMAGE',
  CLEAR_ALL_REFERENCE_IMAGES: 'CLEAR_ALL_REFERENCE_IMAGES',
  SET_SELECTED_REFERENCE_IMAGE: 'SET_SELECTED_REFERENCE_IMAGE',
};

export const DEFAULT_PROJECT = {
  projectName: '',
  tempo: 50,
  tonic: 'a',
  scale: 'major',
  selectedSynths: DEFAULT_SYNTHS,
};

export const getInitState = initState => ({
  projectName: initState.projectName,
  activeColorIndex: 0,
  isGridActive: !!initState.isGridActive,
  isSnapToGridActive: !!initState.isSnapToGridActive,
  isAutoQuantizeActive: !!initState.isAutoQuantizeActive,
  isProximityModeActive: !!initState.isProximityModeActive,
  proximityModeRadius:
    initState.proximityModeRadius || DEFAULT_PROXIMITY_MODE_RADIUS,
  tempo: initState.tempo,
  scaleObj: Teoria.note(initState.tonic).scale(initState.scale),
  activeTool: TOOL_TYPES.DRAW,
  // deliberately session-only, not read from initState - every project
  // opens in musical mode regardless of how it was last left
  canvasMode: CANVAS_MODES.MUSICAL,
  referenceImages: [],
  selectedReferenceImageId: null,
  selectedSynths: initState.selectedSynths,
  knobVals:
    initState.knobVals && initState.knobVals.length > 0
      ? initState.knobVals
      : initState.selectedSynths.map(getDefaultParamValues),
  // which of the 16 colorIndex slots currently have an instrument - the
  // footer (ColorControllerPanel) only renders these; draw-color pickers
  // (ColorPicker, GroupSelectionPanel) only offer these. Starts with just
  // one (Grand Piano, DEFAULT_SYNTHS[0]) rather than all 16 at once.
  activeColorIndices:
    initState.activeColorIndices && initState.activeColorIndices.length > 0
      ? initState.activeColorIndices
      : [0],
});

export const getProjectSaveData = projectData => {
  const {
    name,
    tempo,
    scaleObj,
    isGridActive,
    isSnapToGridActive,
    isAutoQuantizeActive,
    isProximityModeActive,
    proximityModeRadius,
    shapesList,
    selectedSynths,
    knobVals,
  } = projectData;

  return {
    name,
    tempo,
    tonic: scaleObj.tonic.toString(),
    scale: scaleObj.name.toString(),
    isGridActive,
    isSnapToGridActive,
    isAutoQuantizeActive,
    isProximityModeActive,
    proximityModeRadius: parseInt(proximityModeRadius),
    shapesList,
    selectedSynths,
    knobVals,
  };
};

export const getProjectIdFromResponse = project => project.ref['@ref'].id;
