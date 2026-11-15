import { DEFAULT_SYNTHS } from './synths';
import { getDefaultParamValues } from 'utils/synths';
import Teoria from 'teoria';

export const DEFAULT_PROXIMITY_MODE_RADIUS = 400;
export const MIN_PROXIMITY_RADIUS = 50;
export const MAX_PROXIMITY_RADIUS = 900;

export const LAYERS_PANEL_WIDTH = 280;
export const getCanvasWidth = () => window.innerWidth - LAYERS_PANEL_WIDTH;

// Sidebar's base top offset when FileNameBadge is just one line (the
// project name, no imported files) - the badge itself starts at 80px
// (just under the Toolbar) and this is that plus its own single-line
// height. IMPORTED_FILE_LINE_HEIGHT must match FileNameBadge's own
// .importedFile line-height exactly, or the two drift out of sync.
export const SIDEBAR_BASE_TOP = 124;
export const IMPORTED_FILE_LINE_HEIGHT = 18;
// One shared source of truth for "how far down does the imported-files
// list push things below it" - FileNameBadge's own layout grows by this
// same amount per entry, so Sidebar (and anything else stacked below the
// badge) can ask this instead of hardcoding a number that has to be kept
// in sync by hand.
export const getSidebarTopOffset = importedFileNamesCount =>
  importedFileNamesCount > 0
    ? SIDEBAR_BASE_TOP + 2 + importedFileNamesCount * IMPORTED_FILE_LINE_HEIGHT
    : SIDEBAR_BASE_TOP;

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
  // The .geob project's own name (above) is a separate concept from
  // which source files were imported INTO it (below) - see FileNameBadge.
  // ADD appends one more imported file to the list (a geo import adds to
  // whatever's already on the canvas); SET replaces the whole list
  // (a MIDI import replaces the whole canvas, so it starts a fresh list
  // of exactly one; clearing the canvas resets it back to whatever the
  // project's own initState had).
  ADD_IMPORTED_FILE_NAME: 'ADD_IMPORTED_FILE_NAME',
  SET_IMPORTED_FILE_NAMES: 'SET_IMPORTED_FILE_NAMES',
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
  // A "Reference" geo import (Toolbar's handleGeoFileChange,
  // GeoImportModeModal) - every feature in the file as one static, non-
  // musical backdrop layer, same spirit as a reference image but vector
  // geometry instead of a raster. Deliberately NOT part of shapesList -
  // see components/ShapeCanvas/ReferenceGeoLayer's own header comment.
  ADD_REFERENCE_GEO_LAYER: 'ADD_REFERENCE_GEO_LAYER',
  REMOVE_REFERENCE_GEO_LAYER: 'REMOVE_REFERENCE_GEO_LAYER',
  SET_SELECTED_REFERENCE_GEO_LAYER: 'SET_SELECTED_REFERENCE_GEO_LAYER',
  RENAME_REFERENCE_GEO_LAYER: 'RENAME_REFERENCE_GEO_LAYER',
  TOGGLE_REFERENCE_GEO_LAYER_VISIBILITY: 'TOGGLE_REFERENCE_GEO_LAYER_VISIBILITY',
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
  referenceGeoLayers: [],
  selectedReferenceGeoLayerId: null,
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
  // Which source files (MIDI, geo tracks) this project's current canvas
  // was imported from - see FileNameBadge and PROJECT_ACTIONS.
  // ADD_IMPORTED_FILE_NAME/SET_IMPORTED_FILE_NAMES above. Distinct from
  // projectName, which is the .geob file's own name and is never touched
  // by an import any more.
  importedFileNames: initState.importedFileNames || [],
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
    activeColorIndices,
    importedFileNames,
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
    activeColorIndices,
    importedFileNames,
  };
};

export const getProjectIdFromResponse = project => project.ref['@ref'].id;
