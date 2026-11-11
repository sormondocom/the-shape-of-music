import React, {
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Stage, Layer, Group, Circle } from 'react-konva';
import ShapesWrapper from './ShapesWrapper';
import PhantomShape from './PhantomShape';
import Grid from './Grid';
import ReferenceImage from './ReferenceImage';
import GroupSelectionPanel from './GroupSelectionPanel';
import PanScrollbar from './PanScrollbar';
import GeoBaseLayer from './GeoBaseLayer';
import { appColors, themeColors } from 'utils/color';
import { PROJECT_ACTIONS, TOOL_TYPES, CANVAS_MODES } from 'utils/project';
import { DRAWING_STATES } from './Container';

import ProjectContextProvider from 'components/Project/ProjectContextProvider';
import { useProjectContext } from 'context/useProjectContext';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';

export const MousePosContext = React.createContext({});
// Dedicated, separate from the main ProjectContext on purpose: stagePos
// changes on every animation frame while panning (Container.jsx's
// panByKeyboard/handleWheel), and only EdgeMidpoint actually needs it (for
// its "show hint near cursor" screen-space conversion) - putting it in the
// shared context instead would make every shape's components re-render on
// every pan frame (context identity changes bypass React.memo for direct
// consumers), regardless of whether they use stagePos at all.
export const StagePosContext = React.createContext({ x: 0, y: 0 });

// The zoom badge's two looks - plain/small at rest, large/bold while a
// wheel gesture is actively in progress (ShapeCanvas/Container.jsx's
// handleWheel toggles between these via setZoomActive, imperatively).
const ZOOM_BADGE_DEFAULT_STYLE = {
  fontSize: 12,
  fontWeight: 'normal',
  padding: '2px 8px',
  opacity: 0.8,
};
const ZOOM_BADGE_ACTIVE_STYLE = {
  fontSize: 22,
  fontWeight: 'bold',
  padding: '6px 14px',
  opacity: 1,
};

function ShapeCanvasComponent(props, ref) {
  const {
    width,
    height,
    currPoints,
    snapToGrid,
    gridSize,
    mousePos,
    drawingState,
    shapesList,
    selectedShapeIndex,
    selectedShapeIndices,
    soloedShapeIndices,
    deletedShapeIndeces,
    onContentClick,
    onContentMouseMove,
    onDragMove,
    onContentMouseDown,
    onWheel,
    stageScale,
    stagePos,
    onResetZoom,
    horizontalScrollbar,
    verticalScrollbar,
    onPanScrollbarChange,
    handleShapeClick,
    handleShapeDelete,
    handleShapeColorChange,
    handleShapeVolumeChange,
    handleShapeStartOffsetChange,
    handleShapeSoloChange,
    handleShapeMuteChange,
    handleShapeDuplicate,
    onAutoTrace,
    setColorForSelectedShapes,
    clearGroupSelection,
    onBottomChromeHeightChange,
    visibleShapeIndices,
    shapesGeneration,
  } = props;
  const shapesGroupRef = useRef({});
  const stageRef = useRef();
  const zoomBadgeRef = useRef();

  const { isDarkMode } = useColorThemeContext();

  // The Color Controller footer and the Spectrometer panel both render as
  // siblings of this canvas (Project/index.jsx) and sit absolutely
  // positioned at the bottom of the viewport. Measure whichever one's top
  // edge is highest on screen (rather than hardcoding either height, or
  // summing their two heights - see git history for why that drifted out
  // of sync) and report it up to ShapeCanvas/Container.jsx via
  // onBottomChromeHeightChange, which shrinks the Stage's own height by
  // that amount - so #holder's bottom edge ends up exactly flush with the
  // topmost chrome panel, and the scrollbars/zoom badge below (rendered
  // inside #holder) need no offset of their own any more: their plain
  // CSS `bottom: 0` already lands in the right place. This also means
  // shapes can no longer be drawn into the hidden-behind-chrome area,
  // which they previously could (the Stage used to stay full height
  // regardless of what was drawn on top of it).
  useEffect(() => {
    if (!onBottomChromeHeightChange) return undefined;
    const footerEl = document.getElementById('colorControllerPanel');
    const spectrometerEl = document.getElementById('spectrometerPanel');
    // PlayBar sits above the Spectrometer (Project/index.jsx) - added
    // after this measurement was written, and never wired in here, so
    // #holder/the Stage were sized as if PlayBar didn't exist and could
    // extend down behind it. Same "whichever panel's top edge is
    // highest on screen wins" logic, just with a third candidate now.
    const playBarEl = document.getElementById('playBarPanel');
    const update = () => {
      const footerTop = footerEl ? footerEl.getBoundingClientRect().top : window.innerHeight;
      const spectrometerTop = spectrometerEl
        ? spectrometerEl.getBoundingClientRect().top
        : window.innerHeight;
      const playBarTop = playBarEl ? playBarEl.getBoundingClientRect().top : window.innerHeight;
      const topmostChromeEdge = Math.min(footerTop, spectrometerTop, playBarTop);
      onBottomChromeHeightChange(Math.max(0, window.innerHeight - topmostChromeEdge));
    };
    update();
    const observer = new ResizeObserver(update);
    if (footerEl) observer.observe(footerEl);
    if (spectrometerEl) observer.observe(spectrometerEl);
    if (playBarEl) observer.observe(playBarEl);
    // the measurement above also depends on window.innerHeight (to turn
    // "distance from the top" into "distance from the bottom"), which
    // ResizeObserver on the panels alone won't catch
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
    // onBottomChromeHeightChange is a bound class method (ShapeCanvas/
    // Container.jsx) - stable across renders, intentionally excluded so
    // this measurement effect only runs once on mount, same as before.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    getShapeState: shapesGroupRef.current.getShapeState,
    getShapeMIDISequences: shapesGroupRef.current.getShapeMIDISequences,
    getShapeNotationEvents: shapesGroupRef.current.getShapeNotationEvents,
    getVisibleShapeIndices: shapesGroupRef.current.getVisibleShapeIndices,
    // "content" events (onContentMouseMove, etc.) fire with only { evt } -
    // no target/currentTarget at all, unlike shape-level events - so
    // handlers that need the actual Stage instance (to read/convert
    // pointer position through the current zoom/pan) get it from here
    // instead of the event.
    getStage: () => stageRef.current,
    // ShapeCanvas/Container.jsx's handleWheel calls these directly (DOM
    // mutation, not React state) while a zoom gesture is live - see that
    // method's own comment for why the actual stageScale/stagePos commit
    // is deferred until the gesture settles. Keeping the badge in sync
    // during that window still needs SOMETHING to update immediately, or
    // scrolling would look like it's doing nothing until it stops.
    // "the zoom then needs to change to using actual geographic zoom
    // levels" - in geo mode the badge shows the real slippy-map zoom
    // level (stageScale = 2^geoZoom, utils/geoTiles.js) instead of a
    // percentage, matching what every other map app shows.
    setLiveZoomScale: scale => {
      if (!zoomBadgeRef.current) return;
      zoomBadgeRef.current.textContent = isGeoMode
        ? `Z${Math.round(Math.log2(scale))}`
        : `${Math.round(scale * 100)}%`;
    },
    // Grows/bolds the badge while a zoom gesture is actively in progress,
    // so it's obviously "live" even though the canvas itself isn't
    // visibly re-rendering content yet - shrinks back once the gesture
    // settles and commits. React's own next render (stageScale actually
    // changing) would eventually reset this anyway via the JSX below, but
    // setting it false explicitly here means it still happens even if
    // that render happens to be skipped (e.g. scale net-unchanged).
    setZoomActive: isActive => {
      if (!zoomBadgeRef.current) return;
      Object.assign(
        zoomBadgeRef.current.style,
        isActive ? ZOOM_BADGE_ACTIVE_STYLE : ZOOM_BADGE_DEFAULT_STYLE
      );
    },
  }));

  /* 
  NOTE: hack to propagate context through the Konva Stage
  */
  const projectContext = useProjectContext();
  const {
    activeTool,
    isAltPressed,
    isGridActive,
    activeColorIndex,
    activeColorIndices,
    isProximityModeActive,
    proximityModeRadius,
    referenceImages,
    selectedReferenceImageId,
    canvasMode,
    dispatch,
  } = projectContext;
  const isGeoMode = canvasMode === CANVAS_MODES.GEOGRAPHIC;

  // stagePos deliberately excluded - see StagePosContext above. Memoized
  // so this object's reference (and therefore every shape-level
  // useProjectContext() consumer) stays stable across the ~60
  // setState-per-second churn of a pan, only changing when projectContext
  // or stageScale actually do (e.g. an actual zoom).
  const nestedContextValue = useMemo(
    () => ({ ...projectContext, stageScale }),
    [projectContext, stageScale]
  );

  const isEditMode = activeTool === TOOL_TYPES.EDIT;

  // top-left of the group selection's combined bounds, to anchor the bulk
  // recolor panel - approximate (uses each shape's last-synced points, not
  // any in-progress unsaved drag), which is fine for positioning a panel
  let groupSelectionTopLeft = null;
  if (selectedShapeIndices.size > 0) {
    let minX = Infinity;
    let minY = Infinity;
    selectedShapeIndices.forEach(index => {
      const shape = shapesList[index];
      if (!shape) return;
      for (let i = 0; i < shape.points.length; i += 2) {
        minX = Math.min(minX, shape.points[i]);
        minY = Math.min(minY, shape.points[i + 1]);
      }
    });
    if (minX !== Infinity) {
      // convert content coordinates to screen-relative coordinates through
      // the stage's current zoom/pan, so the panel stays anchored to the
      // shapes at any zoom level (identity transform at scale=1/pos=0)
      groupSelectionTopLeft = {
        x: minX * stageScale + stagePos.x,
        y: minY * stageScale + stagePos.y,
      };
    }
  }

  const renderReferenceImage = img => (
    <ReferenceImage
      key={img.id}
      referenceImage={img}
      stageScale={stageScale}
      stagePos={stagePos}
      isSelected={img.id === selectedReferenceImageId}
      onSelectedChange={val =>
        dispatch({
          type: PROJECT_ACTIONS.SET_SELECTED_REFERENCE_IMAGE,
          payload: val ? img.id : null,
        })
      }
      onTransformChange={payload =>
        dispatch({
          type: PROJECT_ACTIONS.UPDATE_REFERENCE_IMAGE_TRANSFORM,
          payload: { id: img.id, ...payload },
        })
      }
      onAutoTrace={(imageEl, regionRect) => onAutoTrace(imageEl, regionRect, img)}
      onDelete={() =>
        dispatch({ type: PROJECT_ACTIONS.REMOVE_REFERENCE_IMAGE, payload: img.id })
      }
    />
  );

  const selectedReferenceImage = referenceImages.find(
    img => img.id === selectedReferenceImageId
  );
  const unselectedReferenceImages = referenceImages.filter(
    img => img.id !== selectedReferenceImageId
  );

  return (
    <div
      id="holder"
      style={{
        width,
        // overrides static/css/main.css's #holder height (calc(100vh -
        // 80px), a static fallback) - #holder is `position: relative`
        // there, so everything positioned `bottom: 0` inside it (the pan
        // scrollbars, zoom badge) resolves against ITS height, not the
        // Stage's. Without this, #holder stayed at the old full height
        // even after the Stage itself shrank to exclude the footer/
        // Spectrometer chrome, leaving the scrollbars positioned at the
        // old boundary - behind that chrome, and so invisible.
        height,
        // Clips anything that visually exceeds this box - most notably
        // ShapeCanvas/Container.jsx's live wheel-zoom preview, which CSS-
        // scales the Stage's own container up while zooming in, before
        // the real (correctly-sized) redraw commits. Without this, that
        // enlarged canvas briefly spills past #holder's own boundary and
        // over whatever sits below it (the instrument footer/Spectrometer/
        // PlayBar) until the gesture settles - exactly the "instrument
        // panel jumps while zooming" symptom this was added to fix.
        overflow: 'hidden',
        cursor: isEditMode && isAltPressed && 'copy',
        background: isDarkMode ? appColors.black : appColors.grayLight,
      }}
      onContextMenu={e => {
        e.preventDefault();
      }}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onContentClick={onContentClick}
        onContentMouseMove={onContentMouseMove}
        onDragMove={onDragMove}
        onContentMouseDown={onContentMouseDown}
        onWheel={onWheel}
      >
        <ProjectContextProvider value={nestedContextValue}>
          <StagePosContext.Provider value={stagePos}>
          <MousePosContext.Provider value={mousePos}>
            {isGeoMode && (
              <GeoBaseLayer
                stageScale={stageScale}
                stagePos={stagePos}
                width={width}
                height={height}
              />
            )}

            {isProximityModeActive && (
              <Layer>
                <Circle
                  x={mousePos.x}
                  y={mousePos.y}
                  transformsEnabled="position"
                  radius={proximityModeRadius}
                  fill={'white'}
                  opacity={0.36}
                  // fillRadialGradientStartPoint={{ x: 0, y: 0 }}
                  // fillRadialGradientStartRadius={0}
                  // fillRadialGradientEndPoint={{ x: 0, y: 0 }}
                  // fillRadialGradientEndRadius={PROXIMITY_MODE_RADIUS}
                  // fillRadialGradientColorStops={[
                  //   0,
                  //   'white',
                  //   0.8,
                  //   'white',
                  //   1,
                  //   'rgba(255,255,255,0)',
                  // ]}
                />
              </Layer>
            )}

            {/* while an image is selected (actively being moved/resized/
                traced), it renders after (on top of) shapes so its
                drag/resize handles are never blocked by shapes sitting
                visually on top of it; every other image stays behind them */}
            {unselectedReferenceImages.length > 0 && (
              <Layer>{unselectedReferenceImages.map(renderReferenceImage)}</Layer>
            )}

            {isGridActive && (
              <Layer>
                <Group>
                  <Grid width={width} height={height} gridSize={gridSize} />
                </Group>
              </Layer>
            )}

            <Layer>
              <Group>
                <ShapesWrapper
                  ref={shapesGroupRef}
                  shapesList={shapesList}
                  deletedShapeIndeces={deletedShapeIndeces}
                  selectedShapeIndex={selectedShapeIndex}
                  selectedShapeIndices={selectedShapeIndices}
                  soloedShapeIndices={soloedShapeIndices}
                  snapToGrid={snapToGrid}
                  handleShapeClick={handleShapeClick}
                  handleShapeDelete={handleShapeDelete}
                  handleShapeDuplicate={handleShapeDuplicate}
                  handleShapeColorChange={handleShapeColorChange}
                  handleShapeVolumeChange={handleShapeVolumeChange}
                  handleShapeStartOffsetChange={handleShapeStartOffsetChange}
                  handleShapeSoloChange={handleShapeSoloChange}
                  handleShapeMuteChange={handleShapeMuteChange}
                  visibleShapeIndices={visibleShapeIndices}
                  shapesGeneration={shapesGeneration}
                />
              </Group>
            </Layer>

            {selectedReferenceImage && (
              <Layer>{renderReferenceImage(selectedReferenceImage)}</Layer>
            )}

            <Layer>
              <PhantomShape
                mousePos={mousePos}
                points={currPoints}
                drawingState={drawingState}
                closed={drawingState === DRAWING_STATES.PREVIEW}
                color={themeColors[activeColorIndex]}
              />
            </Layer>
          </MousePosContext.Provider>
          </StagePosContext.Provider>
        </ProjectContextProvider>
      </Stage>
      {groupSelectionTopLeft && (
        <GroupSelectionPanel
          topLeft={groupSelectionTopLeft}
          count={selectedShapeIndices.size}
          activeColorIndices={activeColorIndices}
          onSelectColor={setColorForSelectedShapes}
          onClose={clearGroupSelection}
        />
      )}
      {isGeoMode && (
        // OSM's tile usage policy requires this attribution to stay
        // visible wherever the tiles are shown - not optional to remove.
        // Bottom-left, clear of the zoom badge (bottom-right) and the
        // scrollbars (right edge / a thin 10px strip along the very
        // bottom).
        <div
          style={{
            position: 'absolute',
            zIndex: 150,
            bottom: 16,
            left: 6,
            fontSize: 10,
            lineHeight: 1,
            padding: '2px 5px',
            borderRadius: 3,
            background: isDarkMode ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)',
            color: isDarkMode ? appColors.grayLight : appColors.grayDark,
          }}
        >
          ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit' }}
          >
            OpenStreetMap
          </a>{' '}
          contributors
        </div>
      )}
      <PanScrollbar
        orientation="horizontal"
        thumbFraction={horizontalScrollbar.thumbFraction}
        positionFraction={horizontalScrollbar.positionFraction}
        onChange={fraction => onPanScrollbarChange('x', fraction)}
      />
      <PanScrollbar
        orientation="vertical"
        thumbFraction={verticalScrollbar.thumbFraction}
        positionFraction={verticalScrollbar.positionFraction}
        onChange={fraction => onPanScrollbarChange('y', fraction)}
      />
      <div
        ref={zoomBadgeRef}
        title="Scroll to zoom - click to reset"
        onClick={onResetZoom}
        style={{
          position: 'absolute',
          // #holder is now sized (ShapeCanvas/Container.jsx's canvasHeight)
          // to end exactly at the Color Controller footer/Spectrometer
          // panel's top edge - no bottomChromeHeight offset needed here
          // any more, just the usual breathing room above the bar.
          zIndex: 150,
          bottom: 20,
          right: 18,
          borderRadius: 4,
          cursor: 'pointer',
          userSelect: 'none',
          color: isDarkMode ? appColors.grayLight : appColors.grayDark,
          background: isDarkMode ? appColors.black : appColors.grayLight,
          // grow/shrink smoothly between ZOOM_BADGE_DEFAULT_STYLE and
          // ZOOM_BADGE_ACTIVE_STYLE (setZoomActive, applied imperatively
          // while a wheel gesture is in progress) rather than snapping
          transition: 'font-size 0.15s, padding 0.15s, opacity 0.15s',
          ...ZOOM_BADGE_DEFAULT_STYLE,
        }}
      >
        {isGeoMode ? `Z${Math.round(Math.log2(stageScale))}` : `${Math.round(stageScale * 100)}%`}
      </div>
    </div>
  );
}

export default forwardRef(ShapeCanvasComponent);
