import React, { useImperativeHandle, useRef, useMemo, forwardRef } from 'react';
import { Circle, Group, Line } from 'react-konva';
import Portal from 'react-portal';

import { getPerimeterLength, getPanningValText } from 'utils/shape';
import { convertValToRange } from 'utils/math';
import { themeColors, appColors } from 'utils/color';
import {
  getDecimatedVertexIndices,
  getDecimatedPoints,
  getPointsBounds,
} from 'utils/shapeCulling';

import ShapeVertex from './ShapeVertex';
import EdgeMidpoint from './EdgeMidpoint';
import ShapeEditorPopover from './ShapeEditorPopover';
import { TOOL_TYPES, getCanvasWidth } from 'utils/project';
import styles from './styles.module.css';
import { useProjectContext } from 'context/useProjectContext';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';

// stable, shared reference for the culled case below - avoids allocating
// a fresh empty Set every render for every culled shape
const EMPTY_SET = new Set();

function ShapeComponent(props, ref) {
  const shapeFillRef = useRef();
  const groupRef = useRef();
  const progressDotRef = useRef();

  /* Functions used to control lower level access on shape */
  useImperativeHandle(ref, () => ({
    getAbsolutePosition: () => shapeFillRef.current.getAbsolutePosition(),
    // Content-space position (relative to the Layer, not the Stage's own
    // zoom/pan transform) - groupRef, not shapeFillRef: the draggable
    // <Group> is what actually carries the shape's position offset in
    // content space, while the fill Line inside it has no offset of its
    // own (points are already relative to the group's origin), so calling
    // .position() on it would just return 0,0.
    getPosition: () => groupRef.current.position(),
    moveToTop: () => {
      groupRef.current.moveToTop();
    },
    moveToBottom: () => {
      groupRef.current.moveToBottom();
    },
    flashFill: fill => {
      if (!shapeFillRef.current) return;
      shapeFillRef.current.setAttrs({ fill: appColors.white });
      shapeFillRef.current.to({ fill, duration: 0.2 });
    },
    setProgressDotAttrs: attrs => {
      if (!progressDotRef.current) return;
      progressDotRef.current.setAttrs(attrs);
    },
    setProgressDotTo: to => {
      if (!progressDotRef.current) return;
      progressDotRef.current.to(to);
    },
    // Viewport culling (ShapeCanvas/Container.jsx's visibility recompute)
    // needs this shape's own content-space bounding box - computed from
    // the live `points`/localBounds this component already holds (below),
    // not from anything rendered, so it stays correct even while THIS
    // shape is itself culled (an empty, invisible Group with nothing to
    // measure) - otherwise a culled shape could never be "found" again
    // once the viewport pans back over it.
    getContentBounds: () => {
      const pos = groupRef.current.position();
      return {
        minX: localBounds.minX + pos.x,
        minY: localBounds.minY + pos.y,
        maxX: localBounds.maxX + pos.x,
        maxY: localBounds.maxY + pos.y,
      };
    },
  }));

  const {
    scaleObj,
    isPlaying,
    activeTool,
    stageScale,
    activeColorIndex,
    activeColorIndices,
  } = useProjectContext();
  const { isDarkMode } = useColorThemeContext();
  const {
    // shape
    index,
    editorPosition,
    volume,
    isMuted,
    isVisible,
    isSoloed,
    colorIndex,
    averagePoint,
    points,
    dragBoundFunc,
    attrs,
    isDragging,
    noteIndexModifier,
    isSelected,
    isGroupSelected,
    isBuffering,
    isSustained,
    noteEvents,
    startOffset,
    previewDotPosition,
    isInViewport,
    // handlers
    handleVolumeChange,
    handleMuteChange,
    handleSoloChange,
    handleColorChange,
    handleStartOffsetChange,
    handleDelete,
    handleQuantizeFactorChange,
    handleToTopClick,
    handleToBottomClick,
    handleClick,
    handleDragStart,
    handleDrag,
    handleDragEnd,
    handleMouseDown,
    handleMouseOver,
    handleMouseOut,
    handleVertexDragMove,
    handleVertexAdd,
    handleVertexDelete,
    handleReverseClick,
    handleDuplicateClick,
    onMouseMove,
    draggable,
  } = props;

  const color = themeColors[colorIndex];
  const isEditMode = activeTool === TOOL_TYPES.EDIT;
  const perimeter = getPerimeterLength(points);
  const startingNoteString = scaleObj.get(noteIndexModifier + 1).toString();
  let panningVal = parseInt(
    convertValToRange(averagePoint.x, 0, getCanvasWidth(), -50, 50),
    10
  );
  const panningValText = getPanningValText(panningVal);

  // This shape's own content-space bounding box - see getContentBounds
  // above (ShapeCanvas/Container.jsx's viewport-culling recompute queries
  // it through that imperative handle); kept as its own small memo so it
  // only recomputes when points actually change, same as everything else
  // here.
  const localBounds = useMemo(() => getPointsBounds(points), [points]);

  // Nothing to actually draw when a shape is well outside the current
  // viewport (ShapeCanvas/Container.jsx passes isInViewport, with a
  // generous margin so nothing pops in/out right at the edge) - skip
  // building any of the detail below and render an empty, invisible,
  // non-listening Group instead (see the bottom of this component).
  // Selected/group-selected shapes are exempted so a shape you're
  // actively working with never flickers away mid-edit purely because
  // the viewport-settle recompute hasn't caught up with where you just
  // dragged it.
  const isCulled = !isInViewport && !isSelected && !isGroupSelected;

  // Which vertices actually get an editing handle/overlay this render -
  // see utils/shapeCulling.js. Only matters for dense shapes; recomputed
  // only when the points themselves or the zoom level change, not on
  // every hover-triggered re-render.
  const decimatedVertexIndices = useMemo(
    () => (isCulled ? EMPTY_SET : getDecimatedVertexIndices(points, stageScale)),
    [isCulled, points, stageScale]
  );

  // The actual drawn outline/fill, decimated - this is the part that
  // matters most for raw canvas repaint cost (utils/shapeCulling.js's
  // getDecimatedPoints comment): a Line with thousands of points means
  // thousands of real lineTo() calls the browser replays on every frame
  // the view changes, independent of React entirely. Only used for the
  // Lines that draw the shape itself (shapeFillRef, lineHalo,
  // simpleOutline) - vertex/midpoint handles, sustainTicks, and
  // restOutline still use the real `points` since those need exact
  // correspondence to real vertices/notes, not just a visually-equivalent
  // simplification.
  const displayPoints = useMemo(
    () => (isCulled ? points : getDecimatedPoints(points, stageScale)),
    [isCulled, points, stageScale]
  );

  // counter-scale against zoom so the dot stays a constant on-screen size,
  // same reasoning as the vertex/midpoint handles (ShapeVertex.jsx). While
  // playing, position comes entirely from ContainerV2's imperative
  // setProgressDotAttrs/setProgressDotTo calls (animated, note by note);
  // while paused, previewDotPosition (plain React state, PlayBar's scrub
  // preview) drives it directly instead, snapped rather than animated -
  // using props here rather than the imperative path for this case means
  // it's correctly placed the instant it first appears, with no fresh-
  // mount flash at the imperative path's x={-999} sentinel default.
  const progressDot = (isPlaying || previewDotPosition) && (
    <Circle
      key="progress-dot"
      ref={progressDotRef}
      hitGraphEnabled={false}
      transformsEnabled="position"
      x={previewDotPosition ? previewDotPosition.x : -999}
      y={previewDotPosition ? previewDotPosition.y : -999}
      radius={5 / stageScale}
      strokeWidth={2 / stageScale}
      stroke={color}
      fill={color}
    />
  );

  // Notation mark (a short perpendicular tick, like a tenuto) on each
  // edge of a sustained-instrument shape - each edge IS one note in this
  // app's model (utils/shape.js's getNoteInfo), so this marks which notes
  // actually ring on for their full duration vs. naturally decay
  // (utils/synths.js's isSustainedInstrument). Only drawn when sustained -
  // the common (plucked/struck) case stays unmarked and uncluttered.
  const TICK_LENGTH = 7; // on-screen px, counter-scaled like everything else here
  // Memoized - building this is an O(points) pass of Konva Line elements,
  // and without memoizing it, a dense sustained shape rebuilds the whole
  // thing on every render, including every zoom-driven one, even though
  // the result only actually changes when one of these specific inputs
  // does (zoom still counts - the tick length/stroke width are counter-
  // scaled - but a render triggered by, say, an unrelated hover-state
  // change on this same shape no longer redoes this work for nothing).
  const sustainTicks = useMemo(
    () =>
      // isCulled check first - skips the whole Array.from pass (points.
      // length/2 iterations) rather than just skipping the Line inside it
      isSustained &&
      !isCulled && (
        <Group key="sustain-ticks" listening={false} transformsEnabled="position">
          {Array.from({ length: points.length / 2 }, (_, i) => {
            // skip a tick mark for an edge too small on screen to show one
            // usefully anyway (utils/shapeCulling.js) - a dense shape can
            // have thousands of these, each its own Konva node
            if (!decimatedVertexIndices.has(i)) return null;
            const x1 = points[i * 2];
            const y1 = points[i * 2 + 1];
            const isLastEdge = i === points.length / 2 - 1;
            const x2 = isLastEdge ? points[0] : points[i * 2 + 2];
            const y2 = isLastEdge ? points[1] : points[i * 2 + 3];
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const edgeLen = Math.hypot(x2 - x1, y2 - y1) || 1;
            const half = TICK_LENGTH / stageScale / 2;
            // perpendicular to the edge, so the tick crosses it like a '|'
            const offsetX = (-(y2 - y1) / edgeLen) * half;
            const offsetY = ((x2 - x1) / edgeLen) * half;
            return (
              <Line
                key={i}
                points={[midX - offsetX, midY - offsetY, midX + offsetX, midY + offsetY]}
                stroke={color}
                strokeWidth={2 / stageScale}
              />
            );
          })}
        </Group>
      ),
    [isSustained, isCulled, points, decimatedVertexIndices, color, stageScale]
  );

  // Per-edge rest visualization: an imported MIDI note can ring for only
  // part of its edge then go silent until the next one (utils/midiImport.js's
  // gap vs ringDuration) - split that edge into a solid lead-in (the part
  // that actually sounds) and a dashed tail (the rest) so the silence is
  // visible, not just audible. Hand-drawn shapes have no ringDuration at
  // all (ringDuration === duration always), so restFractions is all 1s and
  // this never kicks in for them - the base shapeLine below keeps its own
  // stroke exactly as before in that (overwhelmingly common) case.
  const hasAbsoluteNotes = noteEvents && noteEvents.length === points.length / 2;
  const restFractions = hasAbsoluteNotes
    ? noteEvents.map(ev =>
        ev.ringDuration !== undefined && ev.duration > 0
          ? Math.min(1, ev.ringDuration / ev.duration)
          : 1
      )
    : null;
  const hasRests = restFractions && restFractions.some(f => f < 0.999);

  // mirrors each mode's own (pre-existing) stroke logic exactly - edit
  // mode's selection highlight/glow, or non-edit mode's plain `color`
  // (not attrs.stroke, which is a darker shade reserved for edit mode)
  const outlineStroke = isEditMode
    ? isSelected || isGroupSelected
      ? '#00aaff'
      : attrs.stroke
    : color;
  const outlineStrokeWidth = isEditMode
    ? isSelected || isGroupSelected
      ? 5 / stageScale
      : attrs.strokeWidth
    : attrs.strokeWidth;
  const outlineGlow = isEditMode && (isSelected || isGroupSelected);
  // memoized so its reference only changes when the condition actually
  // does, not on every render - otherwise it'd defeat the memoization of
  // simpleOutline/restOutline below, which depend on it
  const outlineGroupDash = useMemo(
    () => (isEditMode && isGroupSelected ? [8, 5] : undefined),
    [isEditMode, isGroupSelected]
  );

  // A self-intersecting shape (common on a melodic MIDI import, which
  // zigzags back over its own earlier path) or several overlapping shapes
  // stacked on the canvas both bury the outline under color - the fill(s)
  // sit between the line and whatever's underneath, so a stroke in the
  // shape's own (often similarly-saturated) hue can read as barely there.
  // A neutral halo - stroked wider, in a flat white/black depending on
  // theme, directly under the colored outline - gives the line contrast
  // against *any* background without touching fill alpha or the Group's
  // own opacity (still the only mute indicator). It lives in the same
  // Group as everything else, so muting/soloing dims it right along with
  // the rest of the shape - never a workaround for that, just contrast.
  const haloColor = isDarkMode ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)';
  const haloExtraWidth = outlineGlow ? 3 / stageScale : 3;
  const haloStrokeWidth = outlineStrokeWidth + haloExtraWidth;
  const lineHalo = (
    <Line
      key="line-halo"
      listening={false}
      points={displayPoints}
      closed
      stroke={haloColor}
      strokeWidth={haloStrokeWidth}
      strokeScaleEnabled={false}
      lineJoin="round"
      transformsEnabled="position"
    />
  );

  // The ordinary (no-rest) outline - one closed Line instead of restOutline's
  // N per-edge segments, since most shapes never have a rest and don't need
  // the extra Konva nodes that per-edge rendering costs.
  const simpleOutline = useMemo(
    () =>
      !hasRests && (
        <Line
          key="shape-outline"
          listening={false}
          points={displayPoints}
          closed
          stroke={outlineStroke}
          strokeWidth={outlineStrokeWidth}
          dash={outlineGroupDash}
          strokeScaleEnabled={false}
          lineJoin={isEditMode ? 'bevel' : 'miter'}
          shadowColor={outlineGlow ? '#00aaff' : undefined}
          shadowBlur={outlineGlow ? 14 / stageScale : 0}
          shadowOpacity={outlineGlow ? 0.9 : 0}
          transformsEnabled="position"
        />
      ),
    [hasRests, displayPoints, outlineStroke, outlineStrokeWidth, outlineGroupDash, isEditMode, outlineGlow, stageScale]
  );

  // Memoized for the same reason as sustainTicks above - this is an
  // O(points) pass building up to 2 Konva elements per edge, and a dense
  // shape with a rest (the one MIDI import case that actually hits this
  // path) can have thousands of edges. Zoom still invalidates it (several
  // of these inputs are counter-scaled), but an unrelated re-render of
  // this same shape no longer rebuilds the whole outline for nothing.
  const restOutline = useMemo(() => {
    // isCulled check first - same reasoning as sustainTicks above, skips
    // the whole Array.from pass rather than just the elements inside it
    if (isCulled) return false;
    const restDash = [6 / stageScale, 5 / stageScale];
    return (
      hasRests && (
        <Group key="rest-outline" listening={false} transformsEnabled="position">
          {Array.from({ length: points.length / 2 }, (_, i) => {
            const x1 = points[i * 2];
            const y1 = points[i * 2 + 1];
            const isLastEdge = i === points.length / 2 - 1;
            const x2 = isLastEdge ? points[0] : points[i * 2 + 2];
            const y2 = isLastEdge ? points[1] : points[i * 2 + 3];
            const frac = restFractions[i];
            // An edge too small on screen to usefully show its own rest-dash
            // detail (utils/shapeCulling.js) still needs to draw SOMETHING -
            // unlike sustainTicks/midpoints/vertex handles (pure overlays or
            // editing affordances), this group IS the shape's actual visible
            // outline whenever hasRests is true, so skipping it outright
            // would leave a real gap in the drawn perimeter. Collapsing to
            // one plain solid segment (no dash, no shadow) keeps the outline
            // whole while still cutting this edge's node count and dropping
            // its most expensive props (shadowBlur rasterizes every frame).
            if (!decimatedVertexIndices.has(i)) {
              return (
                <Line
                  key={i}
                  points={[x1, y1, x2, y2]}
                  stroke={outlineStroke}
                  strokeWidth={outlineStrokeWidth}
                  strokeScaleEnabled={false}
                  lineCap="round"
                />
              );
            }
            const shared = {
              strokeScaleEnabled: false,
              lineCap: 'round',
              shadowColor: outlineGlow ? '#00aaff' : undefined,
              shadowBlur: outlineGlow ? 14 / stageScale : 0,
              shadowOpacity: outlineGlow ? 0.9 : 0,
            };
            if (frac >= 0.999) {
              return (
                <Line
                  key={i}
                  points={[x1, y1, x2, y2]}
                  stroke={outlineStroke}
                  strokeWidth={outlineStrokeWidth}
                  dash={outlineGroupDash}
                  {...shared}
                />
              );
            }
            const midX = x1 + (x2 - x1) * frac;
            const midY = y1 + (y2 - y1) * frac;
            return (
              <Group key={i}>
                <Line
                  points={[x1, y1, midX, midY]}
                  stroke={outlineStroke}
                  strokeWidth={outlineStrokeWidth}
                  {...shared}
                />
                <Line
                  points={[midX, midY, x2, y2]}
                  stroke={outlineStroke}
                  strokeWidth={outlineStrokeWidth}
                  dash={restDash}
                  {...shared}
                />
              </Group>
            );
          })}
        </Group>
      )
    );
  }, [
    isCulled,
    hasRests,
    points,
    decimatedVertexIndices,
    restFractions,
    outlineStroke,
    outlineStrokeWidth,
    outlineGlow,
    outlineGroupDash,
    stageScale,
  ]);

  // Well outside the current viewport (and not selected) - nothing to
  // draw, nothing to hit-test, nothing to animate. The Group still
  // exists (same key/ref as the real thing below, so Konva treats this
  // as the SAME node rather than unmounting/remounting it) purely so
  // getContentBounds/getPosition keep working - that's what lets
  // ShapeCanvas/Container.jsx notice this shape again once the viewport
  // comes back around to it.
  if (isCulled) {
    return <Group key="shapeGroup" ref={groupRef} visible={false} listening={false} transformsEnabled="position" />;
  }

  if (isEditMode) {
    return (
      <Group
        key="shapeGroup"
        ref={groupRef}
        visible={isVisible}
        draggable={draggable}
        dragBoundFunc={dragBoundFunc}
        onMouseMove={onMouseMove}
        onDragMove={handleDrag}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        opacity={attrs.opacity}
        transformsEnabled="position"
      >
        {/* shape perimeter - fill and hit-testing only now; the visible
            outline is lineHalo + (simpleOutline or restOutline) below, so
            it stays prominent over the fill (and anything behind it)
            regardless of self-intersection or shape stacking */}
        <Line
          key="shapeLine"
          ref={shapeFillRef}
          points={displayPoints}
          fill={attrs.fill}
          closed
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseOver={handleMouseOver}
          onMouseOut={handleMouseOut}
          transformsEnabled="position"
        />
        {lineHalo}
        {hasRests ? restOutline : simpleOutline}

        {/* Midpoints - skipped for a vertex too small on screen to
            usefully grab/click right now (utils/shapeCulling.js); a dense
            shape means fewer interactive Konva nodes at low zoom, nothing
            about the point's real data changes, and zooming in reveals it
            again */}
        {points.map((x, i, arr) => {
          if (i % 2) return null;
          if (!decimatedVertexIndices.has(i / 2)) return null;
          return (
            <EdgeMidpoint
              key={i}
              index={i}
              color={color}
              handleMouseDown={handleVertexAdd(i)}
              p1={{ x: x, y: arr[i + 1] }}
              p2={{ x: arr[i + 2] || arr[0], y: arr[i + 3] || arr[1] }}
            />
          );
        })}

        {/* shape verteces - same decimation as the midpoints above */}
        {points.map(
          (p, i, arr) =>
            !(i % 2) &&
            decimatedVertexIndices.has(i / 2) && (
              <ShapeVertex
                dragBoundFunc={dragBoundFunc}
                key={i}
                index={i}
                p={{ x: p, y: arr[i + 1] }}
                handleVertexDragMove={handleVertexDragMove(i)}
                handleVertexDelete={handleVertexDelete(i)}
                color={color}
              />
            )
        )}

        {/* node that travels around the perimeter when playing */}
        {progressDot}

        {/* per-edge sustained-note notation */}
        {sustainTicks}

        {/* tooltip that appears on drag */}
        <Portal isOpened={isDragging}>
          <div
            className={styles.shapeDraggingInfo}
            style={{
              backgroundColor: color,
              top: averagePoint.y + 40,
              left: averagePoint.x - 40,
            }}
          >
            <div>
              {`PAN: ${panningValText}`}
              <br />
              {`NOTE: ${startingNoteString}`}
            </div>
          </div>
        </Portal>
        {/* editor panel that opens on shape click */}
        <Portal isOpened={isSelected}>
          <ShapeEditorPopover
            index={index}
            position={editorPosition}
            colorIndex={colorIndex}
            volume={volume}
            perimeter={perimeter}
            isMuted={isMuted}
            isSoloed={isSoloed}
            startOffset={startOffset}
            // react-portal (which mounts this popover to document.body) uses
            // the legacy unstable_renderSubtreeIntoContainer API, which does
            // NOT propagate React.createContext values into the portaled
            // subtree - so ColorPicker inside it can't read these via
            // useProjectContext/withProjectContext on its own. Passed down
            // explicitly instead, same pattern ColorController already uses.
            activeColorIndex={activeColorIndex}
            activeColorIndices={activeColorIndices}
            // handlers
            onSoloChange={handleSoloChange}
            onMuteChange={handleMuteChange}
            onVolumeChange={handleVolumeChange}
            onStartOffsetChange={handleStartOffsetChange}
            onColorChange={handleColorChange(index)}
            onQuantizeFactorChange={handleQuantizeFactorChange}
            onReverseClick={handleReverseClick}
            onToTopClick={handleToTopClick}
            onToBottomClick={handleToBottomClick}
            onDeleteClick={() => handleDelete(index)}
            onDuplicateClick={handleDuplicateClick}
          />
        </Portal>
      </Group>
    );
  } else {
    return (
      <Group
        key="shapeGroup"
        ref={groupRef}
        visible={isVisible}
        hitGraphEnabled={false}
        draggable={false}
        opacity={attrs.opacity}
        transformsEnabled="position"
      >
        <Line
          key="shapeLine"
          ref={shapeFillRef}
          transformsEnabled="position"
          points={displayPoints}
          fill={attrs.fill}
          closed
        />
        {lineHalo}
        {hasRests ? restOutline : simpleOutline}

        {/* loading indicator */}
        <Portal isOpened={isBuffering}>
          <div
            className={styles.shapeDraggingInfo}
            style={{
              backgroundColor: color,
              top: averagePoint.y + 40,
              left: averagePoint.x - 20,
            }}
          >
            {'Loading samples...'}
          </div>
        </Portal>

        <ShapeVertex
          index={0}
          color={color}
          p={{
            x: points[0],
            y: points[1],
          }}
          handleVertexDragMove={handleVertexDragMove(0)}
          handleVertexDelete={handleVertexDelete(0)}
        />

        {progressDot}
        {sustainTicks}
      </Group>
    );
  }
}

export default forwardRef(ShapeComponent);
