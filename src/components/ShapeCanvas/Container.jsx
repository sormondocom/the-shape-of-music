import React, { Component } from 'react';
import { object, string, number, array, bool, func } from 'prop-types';

import { convertValToRange, dist } from 'utils/math';
import { themeColors } from 'utils/color';
import ShapeCanvasComponent from './Component';
import LayersPanel from 'components/LayersPanel';
import SheetPreviewModal from 'components/SheetPreviewModal';
import { PROJECT_ACTIONS, TOOL_TYPES, CANVAS_MODES, getCanvasWidth } from 'utils/project';
import {
  PRESET_SHAPES,
  generateRegularPolygonPoints,
  ZERO_TRANSPOSITION_CONTENT_Y,
} from 'utils/shape';
import { traceShapesFromImage } from 'utils/imageTrace';
import { showErrorMessage, showSuccessMessage } from 'utils/message';
import { getScrollbarMetrics, getStagePosFromFraction } from 'utils/panScrollbar';
import {
  MIN_GEO_ZOOM,
  MAX_GEO_ZOOM,
  getDefaultGeoView,
  frameGeoBounds,
  getGeoScrollbarMetrics,
  getGeoStagePosFromFraction,
} from 'utils/geoTiles';

import withProjectContext from 'components/Project/withProjectContext';
import Tone from 'tone';

export const DRAWING_STATES = {
  PENDING: 'pending', // not currently drawing
  PREVIEW: 'preview', // mouse is hovered over final position, showing a preview of the finished shape
  DRAWING: 'drawing', // drawing but not previewing
};

/* Setup Tone Listener */
Tone.Listener.upX = 0;
Tone.Listener.upY = 0;
Tone.Listener.upZ = 1;
Tone.Listener.forwardX = 1;
Tone.Listener.forwardY = 1;
Tone.Listener.forwardZ = 0;

const updateToneListener = (x, y) => {
  Tone.Listener.setPosition(x, y, 40);
};

const propTypes = {
  onMount: func.isRequired,
  // Context
  activeTool: string.isRequired,
  tempo: number.isRequired,
  scaleObj: object.isRequired,
  isPlaying: bool.isRequired,
  isGridActive: bool.isRequired,
  isSnapToGridActive: bool.isRequired,
  isAutoQuantizeActive: bool.isRequired,
  isProximityModeActive: bool.isRequired,
  activeColorIndex: number.isRequired,
  knobVals: array.isRequired,
  dispatch: func.isRequired,
  imperativeHandlers: object,
  referenceImages: array,
  selectedReferenceImageId: string,
  canvasMode: string.isRequired,
};

/*
  The ShapeCanvas is canvas where the shapes are drawn
*/
class ShapeCanvas extends Component {
  constructor(props) {
    super(props);

    this.initState = {
      shapesList: [],
      deletedShapeIndeces: [],
      selectedShapeIndex: -1,
      selectedShapeIndices: new Set(),
      soloedShapeIndices: new Set(),
      currPoints: [],
      drawingState: DRAWING_STATES.PENDING,
      mousePos: { x: -10, y: -10 },
      gridSize: 50,
      stageScale: 1,
      stagePos: { x: 0, y: 0 },
      isSheetPreviewOpen: false,
      sheetPreviewData: [],
      sheetPreviewFilterIndex: null,
    };

    this.shapeRefs = [];

    // Deliberately NOT part of initState (so clearAll() - which resets to
    // ...initState - doesn't stomp it back to 0): how much of the bottom
    // of the viewport the Color Controller footer/Spectrometer panel are
    // currently covering, measured by ShapeCanvasComponent and reported up
    // via onBottomChromeHeightChange. Used to shrink the Stage itself so
    // shapes can't be drawn into that hidden-behind-chrome area at all -
    // previously only the scrollbar's own position accounted for it, so
    // the Stage stayed hit-testable underneath the chrome regardless.
    // visibleShapeIndices: null means "no viewport-culling pass has run
    // yet" - treated as "everything visible" (ShapesWrapper.jsx) rather
    // than culling everything until the first recompute lands. Also
    // deliberately not part of initState, same reasoning as
    // bottomChromeHeight above - clearAll() doesn't need to touch it,
    // it'll just get recomputed against whatever's left.
    // Bumped every time shapesList is wholesale REPLACED (clearAll,
    // importMidiShapes) rather than appended to - folded into
    // ShapesWrapper.jsx's key for each <Shape> (see that file) so React
    // never reuses an old shape's component instance for a new, unrelated
    // one that happens to land at the same array index. Without this, a
    // shape reused that way keeps its OLD local state (points, noteEvents
    // - seeded from initialPoints/initialNoteEvents props only once, on
    // true mount, via useState's lazy initializer) even though it's now
    // receiving a totally different shape's props, including never
    // disposing/recreating its own synth - which is exactly "the new
    // import picks up where the old one left off": it's not a new shape
    // misbehaving, it's the OLD shape's Tone.Part, never actually torn
    // down, still playing its own original content and schedule.
    this.state = {
      ...this.initState,
      bottomChromeHeight: 0,
      visibleShapeIndices: null,
      shapesGeneration: 0,
      // this.state.stageScale/stagePos is always "whichever mode's view is
      // CURRENTLY active" - musical and geographic each need their own
      // independent pan/zoom (a geo stageScale of e.g. 8 means something
      // completely different from a musical one), so switching modes
      // (switchViewForMode, driven off a canvasMode prop change) swaps the
      // other mode's view in/out of these two fields rather than keeping
      // four fields threaded through every piece of code that already
      // reads/writes stageScale/stagePos today. These two hold whatever
      // was swapped OUT, so switching back restores it exactly. Null means
      // "never visited that mode this session" - switchViewForMode
      // computes a sensible default on first visit rather than reusing a
      // null. Deliberately outside initState (like bottomChromeHeight) -
      // clearAll() resets the canvas and its CURRENT view, not whatever
      // the other mode was parked at.
      savedGeoView: null,
      savedMusicalView: null,
    };

    this.defaultVolume = -5;
    this.originLockRadius = 15;
    // handleWheel's live-preview/deferred-commit zoom - see that method
    this.liveStageScale = null;
    this.liveStagePos = null;
    this.isZoomGestureActive = false;
    // viewport-culling's own settle timer - see recomputeVisibleShapes
    this.visibilitySettleTimeoutId = null;
    this.zoomSettleTimeoutId = null;

    this.snapToGrid = this.snapToGrid.bind(this);
    this.clearAll = this.clearAll.bind(this);
    this.switchViewForMode = this.switchViewForMode.bind(this);
    this.commitZoom = this.commitZoom.bind(this);
    this.applyLiveZoomPreview = this.applyLiveZoomPreview.bind(this);
    this.recomputeVisibleShapes = this.recomputeVisibleShapes.bind(this);

    this.getShapesList = this.getShapesList.bind(this);
    this.getScreenshot = this.getScreenshot.bind(this);
    this.duplicateShape = this.duplicateShape.bind(this);
    this.insertPresetShape = this.insertPresetShape.bind(this);
    this.traceReferenceImage = this.traceReferenceImage.bind(this);
    this.importMidiShapes = this.importMidiShapes.bind(this);
    this.importGeoShapes = this.importGeoShapes.bind(this);
    this.setColorForSelectedShapes = this.setColorForSelectedShapes.bind(this);
    this.recolorAllShapesWithColor = this.recolorAllShapesWithColor.bind(this);
    this.clearGroupSelection = this.clearGroupSelection.bind(this);
    this.selectAllShapes = this.selectAllShapes.bind(this);
    this.openSheetPreview = this.openSheetPreview.bind(this);
    this.previewShapeSheet = this.previewShapeSheet.bind(this);
    this.refreshSheetPreview = this.refreshSheetPreview.bind(this);
    this.closeSheetPreview = this.closeSheetPreview.bind(this);
    this.showAllSheetPreview = this.showAllSheetPreview.bind(this);
    this.handleBottomChromeHeightChange = this.handleBottomChromeHeightChange.bind(this);

    this.handleClick = this.handleClick.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDrag = this.handleMouseDrag.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.resetZoom = this.resetZoom.bind(this);
    this.handlePanScrollbarChange = this.handlePanScrollbarChange.bind(this);
    this.panByKeyboard = this.panByKeyboard.bind(this);
    this.zoomByStep = this.zoomByStep.bind(this);
    this.handleShapeClick = this.handleShapeClick.bind(this);
    this.handleShapeDelete = this.handleShapeDelete.bind(this);

    this.handleShapeColorChange = this.handleShapeColorChange.bind(this);
    this.handleShapeVolumeChange = this.handleShapeVolumeChange.bind(this);
    this.handleShapeStartOffsetChange = this.handleShapeStartOffsetChange.bind(this);
    this.handleShapeNameChange = this.handleShapeNameChange.bind(this);
    this.handleShapeVisibilityChange = this.handleShapeVisibilityChange.bind(this);
    this.handleShapeSoloChange = this.handleShapeSoloChange.bind(this);
    this.handleShapeMuteChange = this.handleShapeMuteChange.bind(this);
    this.ensurePlaying = this.ensurePlaying.bind(this);
    this.setSoloedShapes = this.setSoloedShapes.bind(this);
    this.addToSoloedShapes = this.addToSoloedShapes.bind(this);
    this.clearSoloedShapes = this.clearSoloedShapes.bind(this);
  }

  componentDidMount() {
    const { onMount, initShapesList } = this.props;
    console.log('initshapeslist', initShapesList);
    onMount(this);
    this.setState(
      {
        shapesList: initShapesList || [],
      },
      this.recomputeVisibleShapes
    );
    // this.setState({
    //   shapesList: this.generateRandomShapes(2, 4),
    // });
  }

  componentDidUpdate(prevProps, prevState) {
    // Toggling CanvasModeToggle swaps the active view (stageScale/
    // stagePos) for the new mode's own remembered pan/zoom - see
    // switchViewForMode and this.state's own comment on savedGeoView/
    // savedMusicalView.
    if (prevProps.canvasMode !== this.props.canvasMode) {
      this.switchViewForMode(this.props.canvasMode);
    }
    // Re-check which shapes are actually in the viewport once the view
    // has settled after any pan or zoom (reference equality here is
    // intentional and cheap - stagePos/stageScale are only ever replaced
    // wholesale via setState, never mutated in place, so "changed" is a
    // plain !==) - debounced, since those fire rapidly while panning/
    // zooming and there's no point recomputing for a view nobody's
    // settled on yet.
    if (
      prevState.stagePos !== this.state.stagePos ||
      prevState.stageScale !== this.state.stageScale
    ) {
      clearTimeout(this.visibilitySettleTimeoutId);
      this.visibilitySettleTimeoutId = setTimeout(this.recomputeVisibleShapes, 150);
    }
    // Shapes being added/removed/imported is a discrete event, not a
    // rapid-fire one like pan/zoom - recompute right away rather than
    // debouncing, or a just-drawn shape would sit invisible (not yet in
    // the last-computed visibleShapeIndices Set at all, which
    // ShapesWrapper.jsx treats as "not visible" for any index it
    // doesn't recognize) for the length of that debounce.
    if (prevState.shapesList !== this.state.shapesList) {
      this.recomputeVisibleShapes();
    }
  }

  componentWillUnmount() {
    clearTimeout(this.zoomSettleTimeoutId);
    clearTimeout(this.visibilitySettleTimeoutId);
  }

  // The current visible content rect, in content-space units - a generous
  // margin (scaled back into content units by the current zoom) is added
  // on every side so a shape just past the literal edge doesn't visibly
  // pop in/out right at the boundary.
  computeViewportRect() {
    const { stagePos, stageScale, bottomChromeHeight } = this.state;
    const width = getCanvasWidth();
    const height = window.innerHeight - 80 - bottomChromeHeight;
    const margin = 300 / stageScale;
    return {
      minX: -stagePos.x / stageScale - margin,
      minY: -stagePos.y / stageScale - margin,
      maxX: (width - stagePos.x) / stageScale + margin,
      maxY: (height - stagePos.y) / stageScale + margin,
    };
  }

  // The actual recompute, run only once the view has settled (see
  // componentDidUpdate above) rather than on every pan/zoom frame -
  // queries each shape's own LIVE content bounds through
  // ShapeCanvasComponent/ShapesWrapper (Shape/ComponentV2.jsx's
  // getContentBounds), so a shape dragged/edited since it was created
  // is checked against where it actually is now, not stale state here.
  recomputeVisibleShapes() {
    if (!this.shapeCanvas || !this.shapeCanvas.getVisibleShapeIndices) return;
    const visibleShapeIndices = this.shapeCanvas.getVisibleShapeIndices(
      this.computeViewportRect()
    );
    this.setState({ visibleShapeIndices });
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (nextProps.activeTool === TOOL_TYPES.DRAW) {
      this.setState({
        selectedShapeIndex: -1,
      });
    }
  }

  getScreenshot() {
    const resizedCanvas = document.createElement('canvas');
    const resizedContext = resizedCanvas.getContext('2d');

    const windowAspectRatio = window.innerHeight / getCanvasWidth();
    const width = 300;
    const height = width * windowAspectRatio;
    resizedCanvas.width = `${width}`;
    resizedCanvas.height = `${height}`;

    const canvas = document.getElementsByTagName('canvas')[0];

    resizedContext.drawImage(canvas, 0, 0, width, height);
    const myResizedData = resizedCanvas.toDataURL();
    return myResizedData;
  }

  getShapesList() {
    const shapesList = this.state.shapesList.slice();
    const { deletedShapeIndeces } = this.state;

    /* Get absolute points for each shape */
    shapesList.forEach((shape, i) => {
      if (deletedShapeIndeces[i]) return;
      const { points, quantizeFactor } = this.shapeCanvas.getShapeState(i);
      shapesList[i].points = points;
      shapesList[i].quantizeFactor = quantizeFactor;
    });

    return shapesList.filter((_, i) => !deletedShapeIndeces[i]);
  }

  appendShape() {
    const { activeColorIndex, canvasMode } = this.props;
    const shapesList = this.state.shapesList.slice();
    const points = this.state.currPoints.slice();
    shapesList.push({
      points,
      colorIndex: activeColorIndex,
      volume: this.defaultVolume,
      isMuted: false,
      // Hand-drawing directly on the geo canvas accumulates points in
      // content-space (screen pixels / stageScale) - at a real map zoom
      // level that's a vastly smaller number than musical mode's
      // "pixel-like" convention (stageScale = 2^geoZoom, so zoom 8 alone
      // shrinks it 256x), which otherwise collapsed every note to a
      // near-instant duration ("murder scene" speed). Capturing the
      // CURRENT stageScale here bakes in "how big this looked on screen
      // when drawn" permanently, independent of whatever zoom the map
      // happens to be at later (utils/shape.js's getNoteInfo multiplies
      // raw edge length by this before computing duration).
      audioScale: canvasMode === CANVAS_MODES.GEOGRAPHIC ? this.state.stageScale : undefined,
    });

    const deletedShapeIndeces = this.state.deletedShapeIndeces.slice();
    deletedShapeIndeces.push(0);

    this.setState({
      shapesList,
      deletedShapeIndeces,
      currPoints: [],
    });
  }

  canChangeTool() {
    return this.state.drawingState === DRAWING_STATES.PENDING;
  }

  cancelInProgressShape() {
    const { drawingState } = this.state;
    if (drawingState !== DRAWING_STATES.PENDING) {
      this.setState({
        currPoints: [],
        drawingState: DRAWING_STATES.PENDING,
      });
    }
  }

  getShapeMIDINoteEvents() {
    console.log(this.shapeCanvas);
    const midiSequences = this.shapeCanvas.getShapeMIDISequences();
    return midiSequences;
  }

  // Sheet Preview's data source - pulled on demand (panel open / refresh
  // click), not kept in sync automatically, same as every other imperative
  // snapshot read off the live shapes (getShapeMIDINoteEvents above,
  // getShapesList used by saveProject).
  getShapeNotationEvents() {
    return this.shapeCanvas.getShapeNotationEvents();
  }

  handleBottomChromeHeightChange(height) {
    if (height !== this.state.bottomChromeHeight) {
      this.setState({ bottomChromeHeight: height });
    }
  }

  openSheetPreview() {
    this.setState({
      isSheetPreviewOpen: true,
      sheetPreviewFilterIndex: null,
      sheetPreviewData: this.getShapeNotationEvents(),
    });
  }

  previewShapeSheet(index) {
    this.setState({
      isSheetPreviewOpen: true,
      sheetPreviewFilterIndex: index,
      sheetPreviewData: this.getShapeNotationEvents(),
    });
  }

  refreshSheetPreview() {
    this.setState({ sheetPreviewData: this.getShapeNotationEvents() });
  }

  closeSheetPreview() {
    this.setState({ isSheetPreviewOpen: false });
  }

  showAllSheetPreview() {
    this.setState({ sheetPreviewFilterIndex: null });
  }

  deleteSelectedShape() {
    const { selectedShapeIndex } = this.state;
    if (selectedShapeIndex >= 0) {
      this.handleShapeDelete(selectedShapeIndex);
    }
  }

  // The sensible "start fresh" view for a given mode - musical's is the
  // fixed scale=1/pos={0,0} this.initState always used; geographic's is a
  // wide default world view (there's no equivalent of "scale 1" that
  // means anything fixed for a map).
  getDefaultViewForMode(mode) {
    if (mode === CANVAS_MODES.GEOGRAPHIC) {
      return getDefaultGeoView(
        getCanvasWidth(),
        window.innerHeight - 80 - this.state.bottomChromeHeight
      );
    }
    return { stageScale: this.initState.stageScale, stagePos: this.initState.stagePos };
  }

  // Fires off a canvasMode prop change (CanvasModeToggle) - swaps
  // this.state.stageScale/stagePos (see their own comment) for the mode
  // being switched TO, saving the view being left behind so switching
  // back restores it exactly rather than resetting it.
  switchViewForMode(newMode) {
    // cancel any in-flight wheel gesture first - its deferred commitZoom
    // would otherwise land ~150ms from now and stomp the swap right back
    // out from under it, same reasoning as resetZoom
    clearTimeout(this.zoomSettleTimeoutId);
    if (this.liveStageScale != null) {
      const container = this.shapeCanvas.getStage().container();
      container.style.transform = '';
      container.style.transformOrigin = '';
      this.liveStageScale = null;
      this.liveStagePos = null;
      this.isZoomGestureActive = false;
      this.shapeCanvas.setZoomActive(false);
    }

    // only two modes exist, so "arriving at X" always means "leaving the
    // other one" - the view being left behind gets saved under whichever
    // mode that was
    const isArrivingAtGeo = newMode === CANVAS_MODES.GEOGRAPHIC;
    this.setState(s => {
      const leftView = { stageScale: s.stageScale, stagePos: s.stagePos };
      const savedPatch = isArrivingAtGeo
        ? { savedMusicalView: leftView }
        : { savedGeoView: leftView };
      const restored = isArrivingAtGeo ? s.savedGeoView : s.savedMusicalView;
      const nextView = restored || this.getDefaultViewForMode(newMode);
      return {
        ...savedPatch,
        stageScale: nextView.stageScale,
        stagePos: nextView.stagePos,
      };
    });
  }

  clearAll() {
    const defaultView = this.getDefaultViewForMode(this.props.canvasMode);
    this.setState(s => ({
      ...this.initState,
      ...defaultView,
      selectedShapeIndices: new Set(),
      shapesGeneration: s.shapesGeneration + 1,
    }));
  }

  setColorForSelectedShapes(colorIndex) {
    const { selectedShapeIndices } = this.state;
    const shapesList = this.state.shapesList.slice();
    selectedShapeIndices.forEach(i => {
      shapesList[i] = { ...shapesList[i], colorIndex };
    });
    this.setState({ shapesList });
  }

  // Moves every shape currently using oldColorIndex over to newColorIndex -
  // the shape-side half of "reassign this instrument's color"
  // (ColorControllerPanel/ColorController dispatches
  // PROJECT_ACTIONS.REASSIGN_INSTRUMENT_COLOR, which calls this via
  // Project/index.jsx's imperativeHandlers, then swaps selectedSynths/
  // knobVals/activeColorIndices for the two indices). Changing a shape's
  // colorIndex here is all that's needed on this side - it's already a
  // normal reactive prop flowing into useShapeSynth/Synth.js, which will
  // pick up the new color's instrument/MIDI channel on its own.
  recolorAllShapesWithColor(oldColorIndex, newColorIndex) {
    const shapesList = this.state.shapesList.map(shape =>
      shape.colorIndex === oldColorIndex ? { ...shape, colorIndex: newColorIndex } : shape
    );
    this.setState({ shapesList });
  }

  clearGroupSelection() {
    this.setState({ selectedShapeIndices: new Set() });
  }

  selectAllShapes() {
    const { shapesList, deletedShapeIndeces } = this.state;
    const selectedShapeIndices = new Set();
    shapesList.forEach((_, i) => {
      if (!deletedShapeIndeces[i]) selectedShapeIndices.add(i);
    });
    this.setState({ selectedShapeIndices, selectedShapeIndex: -1 });
  }

  insertPresetShape(shapeType) {
    const { activeColorIndex, dispatch } = this.props;
    const { sides } = PRESET_SHAPES[shapeType];
    const canvasHeight = window.innerHeight - 80; // matches canvas height (toolbar is 80px)
    const canvasWidth = getCanvasWidth();
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const radius = Math.min(canvasWidth, canvasHeight) * 0.15;
    const points = generateRegularPolygonPoints({
      sides,
      centerX,
      centerY,
      radius,
    });

    const shapesList = this.state.shapesList.slice();
    const newShapeIndex = shapesList.length;
    shapesList.push({
      points,
      colorIndex: activeColorIndex,
      volume: this.defaultVolume,
      isMuted: false,
    });

    const deletedShapeIndeces = this.state.deletedShapeIndeces.slice();
    deletedShapeIndeces.push(0);

    this.setState({
      shapesList,
      deletedShapeIndeces,
      selectedShapeIndex: newShapeIndex,
      selectedShapeIndices: new Set(),
    });

    // switch to Edit mode so the newly inserted shape is immediately
    // draggable/editable and its context menu is visible
    dispatch({ type: PROJECT_ACTIONS.SET_ACTIVE_TOOL, payload: TOOL_TYPES.EDIT });
  }

  importMidiShapes(rawPointsLists, noteEventsLists, colorIndexForTrack, startTimes, loopDuration) {
    const { activeColorIndex, dispatch } = this.props;

    if (!rawPointsLists.length) {
      showErrorMessage('No usable tracks found in that MIDI file');
      return;
    }

    const canvasHeight = window.innerHeight - 80;
    const canvasWidth = getCanvasWidth();
    const targetSize = Math.min(canvasWidth, canvasHeight) * 0.3;

    // Each track's startOffset is relative to the EARLIEST track in this
    // same import, not to the file's own absolute zero - a file that
    // starts with a one-bar drum fill before anything else enters would
    // otherwise give every track a pointless few seconds of dead air.
    // undefined (an older call site, or a track convertMidiTrackToPoints
    // returned null for and got filtered out before this ever sees it)
    // just means "no delay data available" -> starts immediately, same as
    // every shape already did before this existed.
    const validStartTimes = (startTimes || []).filter(t => t !== undefined);
    const earliestStartTime = validStartTimes.length ? Math.min(...validStartTimes) : 0;

    // A MIDI import replaces whatever's currently on the canvas rather than
    // adding to it - previously this appended to this.state.shapesList, so
    // importing a second file (or importing after hand-drawing anything)
    // left the old shapes playing right alongside the new ones, usually
    // out of key/tempo with each other and with no way to tell which
    // shapes came from which source.
    const shapesList = [];
    const deletedShapeIndeces = [];
    const newShapeIndices = new Set();

    rawPointsLists.forEach((rawPoints, trackIndex) => {
      // fit each track's raw walk into a consistent on-canvas size (same
      // spirit as insertPresetShape's radius-based sizing), staggered
      // horizontally per track so multiple tracks don't land on top of
      // each other.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let sumY = 0;
      const vertexCount = rawPoints.length / 2;
      for (let i = 0; i < rawPoints.length; i += 2) {
        minX = Math.min(minX, rawPoints[i]);
        maxX = Math.max(maxX, rawPoints[i]);
        minY = Math.min(minY, rawPoints[i + 1]);
        maxY = Math.max(maxY, rawPoints[i + 1]);
        sumY += rawPoints[i + 1];
      }
      const avgY = sumY / vertexCount;
      const rawWidth = Math.max(1, maxX - minX);
      const rawHeight = Math.max(1, maxY - minY);
      const scale = targetSize / Math.max(rawWidth, rawHeight);
      const stagger = trackIndex * 24;
      const offsetX = canvasWidth / 2 - ((minX + maxX) / 2) * scale + stagger;
      // Targets the shape's *average* point (not the bounding-box
      // midpoint used for offsetX above - a vertical bbox center doesn't
      // land on the same spot as the average for an asymmetric melodic
      // walk) landing exactly on ZERO_TRANSPOSITION_CONTENT_Y, by
      // construction: avgY * scale + offsetY = that target, always,
      // regardless of how the shape's geometry happens to wander.
      //
      // This matters specifically because every imported shape already
      // carries its own exact pitches (Shape/Synth.js's val.midi !==
      // undefined path) - handleDrag (Shape/ContainerV2.jsx) still runs on
      // mount for every shape and adds a semitone shift based on wherever
      // its average point ends up vertically, regardless of shape type.
      // Previously that landed each imported track at an essentially
      // arbitrary Y (each track's own geometry wanders differently), so
      // simultaneously-imported tracks ended up shifted by different,
      // uncontrolled amounts relative to each other - easily enough
      // dissonance to make an import of something as simple as Greensleeves
      // sound like a horror film, independent of the project's own key/
      // scale (which never affected imported pitch at all - only its
      // on-screen geometry). No stagger here (unlike offsetX) - any
      // stagger large enough to be visually useful would just reintroduce
      // a smaller version of the same per-track drift.
      const offsetY = ZERO_TRANSPOSITION_CONTENT_Y - avgY * scale;

      const points = [];
      for (let i = 0; i < rawPoints.length; i += 2) {
        points.push(rawPoints[i] * scale + offsetX);
        points.push(rawPoints[i + 1] * scale + offsetY);
      }

      // Each track gets the channel utils/midiImport.js's
      // assignMidiImportChannels already decided for it (one real GM
      // instrument per track, via ASSIGN_INSTRUMENT_CHANNELS) - falls back
      // to whatever's currently selected only if the caller didn't supply
      // per-track assignments at all (e.g. some other, older call site).
      const colorIndex = colorIndexForTrack ? colorIndexForTrack[trackIndex] : activeColorIndex;
      const trackStartTime = startTimes && startTimes[trackIndex];
      const startOffset =
        trackStartTime !== undefined ? trackStartTime - earliestStartTime : 0;
      newShapeIndices.add(shapesList.length);
      shapesList.push({
        points,
        colorIndex,
        volume: this.defaultVolume,
        isMuted: false,
        noteEvents: noteEventsLists[trackIndex],
        startOffset,
        // same value on every shape from this import - see Toolbar's
        // commonLoopDuration comment
        loopDuration,
      });
      deletedShapeIndeces.push(0);
    });

    // select the whole imported picture as a group, same as a trace result -
    // soloedShapeIndices is reset too since the canvas it referred to no
    // longer exists (its indices would otherwise point at whatever
    // happens to land in the same slot in the new, replaced shapesList).
    // shapesGeneration bumps too - see its own comment in the constructor;
    // this is the wholesale-replace case it exists for.
    this.setState(s => ({
      shapesList,
      deletedShapeIndeces,
      selectedShapeIndex: -1,
      selectedShapeIndices: newShapeIndices,
      soloedShapeIndices: new Set(),
      shapesGeneration: s.shapesGeneration + 1,
    }));

    dispatch({ type: PROJECT_ACTIONS.SET_ACTIVE_TOOL, payload: TOOL_TYPES.EDIT });
    showSuccessMessage(
      `Imported ${rawPointsLists.length} shape${rawPointsLists.length === 1 ? '' : 's'} from MIDI`
    );
  }

  // GPS/GIS vector import (geographic mode: GPX/KML/GeoJSON/Shapefile) -
  // unlike importMidiShapes, this ADDS to whatever's already on the
  // canvas rather than replacing it (Toolbar's handleGeoFileChange). A
  // track has no inherent pitch data to preserve the way an imported
  // MIDI note does, so there's no ZERO_TRANSPOSITION_CONTENT_Y centering
  // trick here either - these points become a shape exactly like a hand-
  // drawn one, getting a semitone shift from handleDrag's usual
  // Y-position logic same as any other shape would.
  //
  // Unlike the old behavior, points are NOT rescaled/centered to fit the
  // canvas - utils/geoTrackImport.js and utils/shapefileImport.js already
  // place every point at its real location in the same world-pixel space
  // (utils/geoTiles.js) the OSM base layer's tiles live in, so the
  // imported route lands exactly where it really is on the map. Instead,
  // the camera flies to frame whatever just got imported, since its real
  // location could be anywhere on Earth relative to wherever the map
  // happened to be pointed before the import.
  importGeoShapes(rawPointsLists, colorIndexForTrack, sourceLabel) {
    const { activeColorIndex, dispatch } = this.props;

    if (!rawPointsLists.length) {
      showErrorMessage('No usable tracks found in that file');
      return;
    }

    const shapesList = this.state.shapesList.slice();
    const deletedShapeIndeces = this.state.deletedShapeIndeces.slice();
    const newShapeIndices = new Set();

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    rawPointsLists.forEach(points => {
      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]);
        maxX = Math.max(maxX, points[i]);
        minY = Math.min(minY, points[i + 1]);
        maxY = Math.max(maxY, points[i + 1]);
      }
    });

    const canvasWidth = getCanvasWidth();
    const canvasHeight = window.innerHeight - 80 - this.state.bottomChromeHeight;
    const { stageScale, stagePos } = frameGeoBounds(
      { minX, minY, maxX, maxY },
      canvasWidth,
      canvasHeight
    );

    // Same normalization issue as hand-drawing directly on the map
    // (appendShape's own comment) - these tracks' raw coordinates are
    // real Web-Mercator world pixels, far too small a magnitude for the
    // duration math to produce sane note lengths from directly. Using
    // the stageScale the camera just framed them AT means "how big this
    // route looks once you can actually see the whole thing" drives the
    // duration, the same "how big it looked on screen" principle
    // appendShape uses for a hand-drawn shape - and since every track
    // from this import shares that one framing scale, their RELATIVE
    // real-world sizes still come through as relatively faster/slower,
    // same as musical mode's existing "bigger shape plays slower" feel.
    rawPointsLists.forEach((points, trackIndex) => {
      const colorIndex = colorIndexForTrack ? colorIndexForTrack[trackIndex] : activeColorIndex;
      newShapeIndices.add(shapesList.length);
      shapesList.push({
        points,
        colorIndex,
        volume: this.defaultVolume,
        isMuted: false,
        audioScale: stageScale,
      });
      deletedShapeIndeces.push(0);
    });

    this.setState({
      shapesList,
      deletedShapeIndeces,
      selectedShapeIndex: -1,
      selectedShapeIndices: newShapeIndices,
      stageScale,
      stagePos,
    });

    dispatch({ type: PROJECT_ACTIONS.SET_ACTIVE_TOOL, payload: TOOL_TYPES.EDIT });
    showSuccessMessage(
      `Imported ${rawPointsLists.length} shape${rawPointsLists.length === 1 ? '' : 's'} from ${sourceLabel}`
    );
  }

  traceReferenceImage(imageEl, regionRect, referenceImage) {
    const { dispatch } = this.props;

    let shapes;
    let totalFound;
    try {
      ({ shapes, totalFound } = traceShapesFromImage({ imageEl, regionRect }));
    } catch (err) {
      showErrorMessage('Could not trace that image');
      return;
    }

    if (!shapes.length) {
      showErrorMessage('No shapes found - try Select Area on a clearer part of the image');
      return;
    }

    const shapesList = this.state.shapesList.slice();
    const newShapeIndices = new Set();
    shapes.forEach(({ points: normalizedPoints, colorIndex, volume }) => {
      const points = [];
      for (let i = 0; i < normalizedPoints.length; i += 2) {
        points.push(referenceImage.x + normalizedPoints[i] * referenceImage.width);
        points.push(referenceImage.y + normalizedPoints[i + 1] * referenceImage.height);
      }
      newShapeIndices.add(shapesList.length);
      shapesList.push({
        points,
        colorIndex,
        volume,
        isMuted: false,
      });
    });

    const deletedShapeIndeces = this.state.deletedShapeIndeces.slice();
    shapes.forEach(() => deletedShapeIndeces.push(0));

    // select the whole traced composition as a group so it can be bulk
    // recolored (e.g. to a single instrument) right away
    this.setState({
      shapesList,
      deletedShapeIndeces,
      selectedShapeIndex: -1,
      selectedShapeIndices: newShapeIndices,
    });

    dispatch({ type: PROJECT_ACTIONS.SET_ACTIVE_TOOL, payload: TOOL_TYPES.EDIT });

    const message = `Traced ${shapes.length} shape${shapes.length === 1 ? '' : 's'}`;
    showSuccessMessage(
      totalFound > shapes.length
        ? `${message} (found ${totalFound} - sampled across the image; try Select Area for more detail)`
        : message
    );
  }

  duplicateShape(index, points) {
    const { shapesList } = this.state;

    const newShapesList = shapesList.slice();
    const { colorIndex } = newShapesList[index];
    const newShape = {
      points: points.map(p => p + 20),
      colorIndex,
      volume: this.defaultVolume,
      isMuted: false,
    };
    newShapesList.push(newShape);
    this.setState({ shapesList: newShapesList });
  }
  /* ============================== HANDLERS ============================== */

  handleMouseDown(e) {
    document.activeElement.blur();
    // don't clear a group selection that's being built - this mousedown
    // fires right before the shift-click that toggles shape membership
    if (e && e.evt && e.evt.shiftKey) return;
    this.setState({
      selectedShapeIndex: -1,
      selectedShapeIndices: new Set(),
    });
  }

  handleClick(e) {
    const { activeTool } = this.props;
    const { drawingState } = this.state;

    // left click
    if (e.evt.which === 1) {
      if (activeTool === TOOL_TYPES.DRAW) {
        // hovering over first point
        if (drawingState === DRAWING_STATES.PREVIEW) {
          this.appendShape();
          this.setState({
            drawingState: DRAWING_STATES.PENDING,
          });
        } else {
          const {
            currPoints,
            mousePos: { x, y },
          } = this.state;
          const len = currPoints.length;
          // only add point if the mouse has moved
          if (!(x === currPoints[len - 2] && y === currPoints[len - 1])) {
            const newPoints = currPoints.slice();

            newPoints.push(x, y);
            this.setState({
              currPoints: newPoints,
              drawingState: DRAWING_STATES.DRAWING,
            });
          }
        }
      }
    }
    // right click to cancel shape mid-draw
    else if (e.evt.which === 3) {
      this.cancelInProgressShape();
    }
  }

  handleMouseDrag({ evt }) {
    const { isProximityModeActive } = this.props;
    const { clientX, clientY } = evt;
    const x = clientX;
    const y = clientY - 80;
    if (isProximityModeActive) {
      updateToneListener(x, y);
    }
    this.setState({
      mousePos: { x, y },
    });
  }

  // Scroll-wheel zoom no longer commits React state (and so a real Konva
  // redraw - every shape's decimated points, counter-scaled strokes, the
  // works) on every single wheel event, or even once per frame. A fast
  // flick fires this many times in a row for a view the user will keep
  // changing for another several hundred milliseconds - redrawing the
  // full scene for each of those intermediate scales is work that gets
  // thrown away the instant the next event arrives, and for a dense scene
  // that work is exactly what was still causing visible lag. Instead:
  // - the already-rendered canvas gets a cheap CSS transform (no Konva/
  //   Canvas2D redraw at all - just the compositor stretching existing
  //   pixels) so zooming still visibly tracks the wheel in real time.
  // - the corner zoom badge updates immediately too (setLiveZoomScale/
  //   setZoomActive - also DOM writes, not React state).
  // - the REAL commit (recompute everything at the final scale, redraw
  //   for real) only happens once wheel events stop arriving for a beat -
  //   see commitZoom.
  handleWheel(e) {
    e.evt.preventDefault();
    const stage = this.shapeCanvas.getStage();
    const pointer = stage.getPointerPosition();
    // Base off the last LIVE (possibly still-uncommitted) value, so a
    // fast flick's successive events keep compounding correctly against
    // each other rather than snapping back to stale committed state.
    const oldScale = this.liveStageScale != null ? this.liveStageScale : this.state.stageScale;
    const stagePos = this.liveStagePos || this.state.stagePos;

    // Geographic mode's zoom range is tile-zoom-level bounds (stageScale
    // = 2^geoZoom, see utils/geoTiles.js's header comment) rather than
    // musical mode's arbitrary 0.3x-120x - this is "the zoom then needs
    // to change to using actual geographic zoom levels": the base map's
    // tiles only exist at integer zoom levels 1-18, so letting the view
    // scale run outside that range would either zoom into a map with no
    // tiles available, or zoom out past the single lowest-detail tile.
    const isGeoMode = this.props.canvasMode === CANVAS_MODES.GEOGRAPHIC;
    const MIN_SCALE = isGeoMode ? Math.pow(2, MIN_GEO_ZOOM) : 0.3;
    const MAX_SCALE = isGeoMode ? Math.pow(2, MAX_GEO_ZOOM) : 120;
    const scaleBy = 1.05;
    const newScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy)
    );

    // zoom centered on the cursor: keep the content point under the pointer
    // fixed in screen space as scale changes
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };

    this.liveStageScale = newScale;
    this.liveStagePos = newPos;

    if (!this.isZoomGestureActive) {
      this.isZoomGestureActive = true;
      this.shapeCanvas.setZoomActive(true);
    }
    this.shapeCanvas.setLiveZoomScale(newScale);
    this.applyLiveZoomPreview(newScale, newPos);

    clearTimeout(this.zoomSettleTimeoutId);
    this.zoomSettleTimeoutId = setTimeout(this.commitZoom, 150);
  }

  // CSS-transforms the Stage's own container div so the CURRENTLY
  // rendered (still at the last COMMITTED scale/pos) canvas visually
  // matches what the LIVE scale/pos would show, without Konva touching a
  // single pixel. transform-origin 0/0 keeps the math simple: a point
  // already on screen at `committedScale*cx + committedPos` needs to end
  // up at `liveScale*cx + livePos` - solving for the CSS scale/translate
  // that does that to every point at once gives ratio = liveScale/
  // committedScale, translate = livePos - ratio*committedPos.
  applyLiveZoomPreview(liveScale, livePos) {
    const container = this.shapeCanvas.getStage().container();
    const { stageScale: committedScale, stagePos: committedPos } = this.state;
    const ratio = liveScale / committedScale;
    container.style.transformOrigin = '0 0';
    container.style.transform = `translate(${livePos.x -
      ratio * committedPos.x}px, ${livePos.y - ratio * committedPos.y}px) scale(${ratio})`;
  }

  // Fires once wheel events stop arriving for 150ms - the real commit:
  // recompute everything at the final live scale/pos for real (every
  // shape's decimated points, counter-scaled strokes, hit regions), then
  // clear the CSS preview transform now that the actual content matches
  // it. The transform is cleared in setState's callback (runs after
  // React/Konva have actually redrawn) rather than right away, so there's
  // no single frame where the preview's gone but the real content hasn't
  // caught up yet.
  commitZoom() {
    if (this.liveStageScale == null) return;
    const container = this.shapeCanvas.getStage().container();
    const finalState = { stageScale: this.liveStageScale, stagePos: this.liveStagePos };
    this.liveStageScale = null;
    this.liveStagePos = null;
    this.isZoomGestureActive = false;
    this.shapeCanvas.setZoomActive(false);
    this.setState(finalState, () => {
      container.style.transform = '';
      container.style.transformOrigin = '';
    });
  }

  resetZoom() {
    // Cancel any in-flight wheel gesture first - otherwise its deferred
    // commitZoom could still fire ~150ms later and stomp this reset right
    // back to wherever the wheel had it.
    clearTimeout(this.zoomSettleTimeoutId);
    this.liveStageScale = null;
    this.liveStagePos = null;
    if (this.isZoomGestureActive) {
      this.isZoomGestureActive = false;
      this.shapeCanvas.setZoomActive(false);
    }
    const container = this.shapeCanvas.getStage().container();
    container.style.transform = '';
    container.style.transformOrigin = '';
    this.setState(this.getDefaultViewForMode(this.props.canvasMode));
  }

  // keyboard zoom (Z/Q) has no cursor position to anchor to like
  // handleWheel does, so it zooms toward the center of the current
  // viewport instead - same "keep a content point fixed in screen space"
  // math, just anchored at the canvas center rather than the pointer.
  // `direction` is +1 (in) or -1 (out); `dt` (seconds) makes this
  // frame-rate independent for continuous zoom while the key is held.
  zoomByStep(direction, dt) {
    const { stageScale: oldScale, stagePos } = this.state;
    const isGeoMode = this.props.canvasMode === CANVAS_MODES.GEOGRAPHIC;
    const MIN_SCALE = isGeoMode ? Math.pow(2, MIN_GEO_ZOOM) : 0.3;
    const MAX_SCALE = isGeoMode ? Math.pow(2, MAX_GEO_ZOOM) : 120;
    const ZOOM_RATE_PER_SEC = 2.2;
    const factor = Math.pow(ZOOM_RATE_PER_SEC, dt);
    const newScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, direction > 0 ? oldScale * factor : oldScale / factor)
    );

    const center = { x: getCanvasWidth() / 2, y: (window.innerHeight - 80) / 2 };
    const contentAtCenter = {
      x: (center.x - stagePos.x) / oldScale,
      y: (center.y - stagePos.y) / oldScale,
    };

    this.setState({
      stageScale: newScale,
      stagePos: {
        x: center.x - contentAtCenter.x * newScale,
        y: center.y - contentAtCenter.y * newScale,
      },
    });
  }

  // dx/dy are in screen pixels, same units stagePos already uses (see
  // handleWheel) - a fixed on-screen step per key press, independent of
  // zoom level, so panning feels consistent whether zoomed in or out
  panByKeyboard(dx, dy) {
    const { stagePos } = this.state;
    this.setState({
      stagePos: { x: stagePos.x + dx, y: stagePos.y + dy },
    });
  }

  handlePanScrollbarChange(axis, fraction) {
    const { stageScale, stagePos } = this.state;
    const canvasSize =
      axis === 'x' ? getCanvasWidth() : window.innerHeight - 80;
    const fromFraction =
      this.props.canvasMode === CANVAS_MODES.GEOGRAPHIC
        ? getGeoStagePosFromFraction
        : getStagePosFromFraction;
    const newAxisPos = fromFraction({
      fraction,
      stageScale,
      canvasSize,
    });
    this.setState({
      stagePos: {
        ...stagePos,
        [axis]: newAxisPos,
      },
    });
  }

  handleMouseMove(e) {
    const { activeTool, isProximityModeActive } = this.props;
    const { drawingState, currPoints, stagePos, stageScale } = this.state;

    // inverse-transform the raw pointer position through the current
    // zoom/pan so drawing and snap-to-grid stay aligned with the cursor at
    // any zoom level (at scale=1/pos=0 this is identical to evt.offsetX/Y).
    // "content" events (this one included) don't carry a target/stage on
    // the event itself, unlike shape-level events - get it from the ref.
    const stage = this.shapeCanvas.getStage();
    const pointer = stage.getPointerPosition();
    const offsetX = (pointer.x - stagePos.x) / stageScale;
    const offsetY = (pointer.y - stagePos.y) / stageScale;

    let x = offsetX;
    let y = offsetY;

    if (isProximityModeActive) {
      updateToneListener(x, y);
    }

    const originX = this.state.currPoints[0];
    const originY = this.state.currPoints[1];

    let newDrawingState =
      drawingState === DRAWING_STATES.PENDING
        ? DRAWING_STATES.PENDING
        : DRAWING_STATES.DRAWING;

    // snap to grid
    x = this.snapToGrid(x);
    y = this.snapToGrid(y);

    if (activeTool === TOOL_TYPES.DRAW) {
      // snap to origin if within radius - originLockRadius is a constant
      // ON-SCREEN distance (same "stays the same size regardless of zoom"
      // principle as the vertex handles), so divide by stageScale to get
      // the equivalent radius in content-space units; without this, at
      // high zoom 15 content-space units is a fraction of a screen pixel,
      // making it practically impossible to close a shape normally and
      // forcing a sprawling, never-closing draw instead
      const originLockRadius = this.originLockRadius / stageScale;
      if (
        currPoints.length > 2 &&
        (dist(offsetX, offsetY, originX, originY) < originLockRadius ||
          (x === originX && y === originY))
      ) {
        x = originX;
        y = originY;
        newDrawingState = DRAWING_STATES.PREVIEW;
      }

      this.setState({
        mousePos: { x: x, y: y },
        drawingState: newDrawingState,
      });
    } else {
      this.setState({
        mousePos: { x: offsetX, y: offsetY },
      });
    }
  }

  /* ====================== Shape handlers ====================== */

  handleShapeClick(index, points, isShiftClick) {
    const { isAltPressed } = this.props;
    if (isShiftClick) {
      const selectedShapeIndices = new Set(this.state.selectedShapeIndices);
      if (selectedShapeIndices.has(index)) {
        selectedShapeIndices.delete(index);
      } else {
        selectedShapeIndices.add(index);
      }
      this.setState({ selectedShapeIndices, selectedShapeIndex: -1 });
    } else if (isAltPressed) {
      this.duplicateShape(index, points);
      this.setState({ selectedShapeIndices: new Set() });
    } else {
      this.setState({
        selectedShapeIndex: index,
        selectedShapeIndices: new Set(),
      });
    }
  }

  handleShapeDelete(index) {
    const deletedShapeIndeces = this.state.deletedShapeIndeces.slice();
    deletedShapeIndeces[index] = true;

    this.setState({ deletedShapeIndeces });
  }

  handleShapeSoloChange(index) {
    const soloedShapeIndices = new Set(this.state.soloedShapeIndices);
    if (soloedShapeIndices.has(index)) {
      soloedShapeIndices.delete(index);
    } else {
      soloedShapeIndices.add(index);
    }
    this.setState({ soloedShapeIndices });
  }

  // "Play Alone"/"Add to Solo"/"Play All" are meant to make something audible
  // right now - start playback too if the transport is stopped, otherwise
  // soloing a shape has no audible effect until Play is pressed separately
  ensurePlaying() {
    const { isPlaying, imperativeHandlers } = this.props;
    if (!isPlaying && imperativeHandlers && imperativeHandlers.togglePlayStop) {
      imperativeHandlers.togglePlayStop();
    }
  }

  setSoloedShapes(indices) {
    this.setState({ soloedShapeIndices: new Set(indices) });
    this.ensurePlaying();
  }

  addToSoloedShapes(indices) {
    const soloedShapeIndices = new Set(this.state.soloedShapeIndices);
    indices.forEach(i => soloedShapeIndices.add(i));
    this.setState({ soloedShapeIndices });
    this.ensurePlaying();
  }

  clearSoloedShapes() {
    this.setState({ soloedShapeIndices: new Set() });
    this.ensurePlaying();
  }

  handleShapeMuteChange(index) {
    return () => {
      const shapes = this.state.shapesList.slice();
      const shape = shapes[index];
      shape.isMuted = !shape.isMuted;
      shapes[index] = shape;

      this.setState({ shapesList: shapes });
    };
  }

  handleShapeColorChange(index) {
    return colorObj => {
      const shapes = this.state.shapesList.slice();
      const shape = shapes[index];
      shape.colorIndex = themeColors.indexOf(colorObj.hex);
      shapes[index] = shape;

      this.setState({
        shapesList: shapes,
      });
    };
  }

  handleShapeVolumeChange(index) {
    return volume => {
      const shapes = this.state.shapesList.slice();
      const shape = shapes[index];
      shape.volume = volume;
      shapes[index] = shape;

      this.setState({
        shapesList: shapes,
      });
    };
  }

  handleShapeStartOffsetChange(index) {
    return startOffset => {
      const shapes = this.state.shapesList.slice();
      const shape = shapes[index];
      shape.startOffset = startOffset;
      shapes[index] = shape;

      this.setState({
        shapesList: shapes,
      });
    };
  }

  // User-given name (LayersPanel's rename UI) - undefined/empty means "no
  // custom name yet", which LayersPanel displays as the default "Layer N"
  // (N = position, not stored - a deleted layer above it would otherwise
  // leave a stored "Layer 2" sitting in the Layer 3 slot). Stored directly
  // on the shape object like colorIndex/volume/startOffset above, so it's
  // automatically included wherever shapesList itself is - save, MIDI/
  // line-art export's getShapesList, everything.
  handleShapeNameChange(index) {
    return name => {
      const shapes = this.state.shapesList.slice();
      const shape = shapes[index];
      shape.name = name;
      shapes[index] = shape;

      this.setState({
        shapesList: shapes,
      });
    };
  }

  // Hiding a shape (LayersPanel's visibility toggle) is deliberately
  // distinct from Mute: it also pulls the shape off the canvas entirely
  // (Shape/ComponentV2.jsx's visible={isVisible}), where Mute just keeps
  // it drawn but silent. Audio-wise the two still end up equivalent -
  // useShapeSynth.js ORs isVisible into the same mute the Synth already
  // understands - so this only needs to flip the one flag.
  handleShapeVisibilityChange(index) {
    return () => {
      const shapes = this.state.shapesList.slice();
      const shape = shapes[index];
      const isCurrentlyVisible = shape.isVisible !== false;
      shape.isVisible = !isCurrentlyVisible;
      shapes[index] = shape;

      this.setState({
        shapesList: shapes,
      });
    };
  }

  /* ================================ GRID ================================ */

  snapToGrid(point) {
    const { isSnapToGridActive } = this.props;
    const { gridSize, stageScale } = this.state;
    if (isSnapToGridActive) {
      // the alignment grid is a deliberate, fixed content-space spacing -
      // correctly zoom-independent, unchanged
      return Math.round(point / gridSize) * gridSize;
    }
    // with grid-snap off, round to the nearest ON-SCREEN pixel rather than
    // a flat content-space integer. At 1x zoom those are the same thing,
    // but at high zoom one content-unit can span many screen pixels, so
    // rounding to a whole content-unit was collapsing all the fine mouse
    // movement a zoomed-in draw is supposed to capture - the shape ended
    // up quantized as coarsely as if you were fully zoomed out.
    const precision = 1 / stageScale;
    return Math.round(point / precision) * precision;
  }

  /* =============================== TESTING ============================== */

  generateRandomShapes(nShapes, nPoints) {
    const shapesList = [];
    for (let i = 0; i < nShapes; i++) {
      const pointsList = [];
      for (let j = 0; j < nPoints * 2; j++) {
        const rand = Math.random();
        if (j % 2) {
          const y = convertValToRange(
            rand,
            0,
            1,
            window.innerHeight * 0.2,
            window.innerHeight * 0.8
          );
          pointsList.push(y);
        } else {
          const x = convertValToRange(
            rand,
            0,
            1,
            getCanvasWidth() * 0.1,
            getCanvasWidth() * 0.9
          );
          pointsList.push(parseInt(x));
        }
      }
      shapesList.push({
        points: pointsList,
        colorIndex: Math.floor(Math.random() * 5),
        volume: this.defaultVolume,
        isMuted: false,
      });
    }

    return shapesList;
  }

  /* =============================== RENDER =============================== */

  render() {
    const {
      gridSize,
      shapesList,
      selectedShapeIndex,
      selectedShapeIndices,
      soloedShapeIndices,
      deletedShapeIndeces,
      mousePos,
      currPoints,
      drawingState,
      stageScale,
      stagePos,
      bottomChromeHeight,
      visibleShapeIndices,
      shapesGeneration,
    } = this.state;

    const canvasWidth = getCanvasWidth();
    // Shrunk by however much of the bottom is currently covered by the
    // Color Controller footer/Spectrometer panel (see
    // handleBottomChromeHeightChange) - this IS the Stage's actual height,
    // not just where the scrollbar/zoom-badge happen to be drawn, so
    // shapes can no longer be placed into that hidden area at all.
    const canvasHeight = window.innerHeight - 80 - bottomChromeHeight;
    const scrollbarMetricsFn =
      this.props.canvasMode === CANVAS_MODES.GEOGRAPHIC
        ? getGeoScrollbarMetrics
        : getScrollbarMetrics;
    const horizontalScrollbar = scrollbarMetricsFn({
      stagePosAxis: stagePos.x,
      stageScale,
      canvasSize: canvasWidth,
    });
    const verticalScrollbar = scrollbarMetricsFn({
      stagePosAxis: stagePos.y,
      stageScale,
      canvasSize: canvasHeight,
    });

    return (
      <>
        <ShapeCanvasComponent
          ref={c => (this.shapeCanvas = c)}
          height={canvasHeight}
          width={canvasWidth}
          gridSize={gridSize}
          onBottomChromeHeightChange={this.handleBottomChromeHeightChange}
          onContentClick={this.handleClick}
          onContentMouseMove={this.handleMouseMove}
          onDragMove={this.handleMouseDrag}
          onContentMouseDown={this.handleMouseDown}
          onWheel={this.handleWheel}
          stageScale={stageScale}
          stagePos={stagePos}
          onResetZoom={this.resetZoom}
          horizontalScrollbar={horizontalScrollbar}
          verticalScrollbar={verticalScrollbar}
          onPanScrollbarChange={this.handlePanScrollbarChange}
          shapesList={shapesList}
          selectedShapeIndex={selectedShapeIndex}
          selectedShapeIndices={selectedShapeIndices}
          soloedShapeIndices={soloedShapeIndices}
          deletedShapeIndeces={deletedShapeIndeces}
          visibleShapeIndices={visibleShapeIndices}
          shapesGeneration={shapesGeneration}
          mousePos={mousePos}
          currPoints={currPoints}
          drawingState={drawingState}
          snapToGrid={this.snapToGrid}
          handleShapeClick={this.handleShapeClick}
          handleShapeDelete={this.handleShapeDelete}
          handleShapeSoloChange={this.handleShapeSoloChange}
          handleShapeColorChange={this.handleShapeColorChange}
          handleShapeVolumeChange={this.handleShapeVolumeChange}
          handleShapeStartOffsetChange={this.handleShapeStartOffsetChange}
          handleShapeMuteChange={this.handleShapeMuteChange}
          handleShapeDuplicate={this.duplicateShape}
          onAutoTrace={this.traceReferenceImage}
          setColorForSelectedShapes={this.setColorForSelectedShapes}
          clearGroupSelection={this.clearGroupSelection}
        />
        <LayersPanel
          shapesList={shapesList}
          deletedShapeIndeces={deletedShapeIndeces}
          selectedShapeIndex={selectedShapeIndex}
          selectedShapeIndices={selectedShapeIndices}
          soloedShapeIndices={soloedShapeIndices}
          onShapeClick={this.handleShapeClick}
          onMuteChange={this.handleShapeMuteChange}
          onVisibilityChange={this.handleShapeVisibilityChange}
          onSoloChange={this.handleShapeSoloChange}
          onNameChange={this.handleShapeNameChange}
          onDelete={this.handleShapeDelete}
          onSelectAll={this.selectAllShapes}
          onClearSelection={this.clearGroupSelection}
          onPlayAlone={this.setSoloedShapes}
          onAddToSolo={this.addToSoloedShapes}
          onPlayAll={this.clearSoloedShapes}
          referenceImages={this.props.referenceImages}
          selectedReferenceImageId={this.props.selectedReferenceImageId}
          onSelectReferenceImage={id =>
            this.props.dispatch({
              type: PROJECT_ACTIONS.SET_SELECTED_REFERENCE_IMAGE,
              payload: id,
            })
          }
          onDeleteReferenceImage={id =>
            this.props.dispatch({
              type: PROJECT_ACTIONS.REMOVE_REFERENCE_IMAGE,
              payload: id,
            })
          }
          onOpenSheetPreview={this.openSheetPreview}
          onPreviewShapeSheet={this.previewShapeSheet}
        />
        {this.state.isSheetPreviewOpen && (
          <SheetPreviewModal
            notationData={this.state.sheetPreviewData}
            filterIndex={this.state.sheetPreviewFilterIndex}
            isPlaying={this.props.isPlaying}
            onClose={this.closeSheetPreview}
            onRefresh={this.refreshSheetPreview}
            onShowAll={this.showAllSheetPreview}
          />
        )}
      </>
    );
  }
}

ShapeCanvas.propTypes = propTypes;

export default withProjectContext(ShapeCanvas);
