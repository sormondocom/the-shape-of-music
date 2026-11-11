import React, {
  useState,
  useRef,
  useContext,
  useEffect,
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
} from 'react';
import { themeColors, appColors } from 'utils/color';
import { TOOL_TYPES, getCanvasWidth } from 'utils/project';
import { ProjectContext } from 'components/Project/ProjectContextProvider';

import { convertValToRange } from 'utils/math';
import {
  getPerimeterLength,
  getAveragePoint,
  getPointsForFixedPerimeterLength,
  convertPointsToMIDINoteEvents,
  convertPointsToNoteEvents,
  PITCH_MODIFIER_MIN,
  PITCH_MODIFIER_MAX,
  PITCH_MODIFIER_SPAN_PX,
} from 'utils/shape';
import Teoria from 'teoria';
import { setCurrentNoteIndex } from 'utils/playbackCursor';
import { subscribeToTransportTime } from 'utils/transportCursor';

import { useShapeAttrs } from './useShapeAttrs';
import { useShapeSynth } from './useShapeSynth';
import ShapeComponent from './ComponentV2';

function ShapeContainerV2(props, ref) {
  console.log('shape render');
  const { activeTool, isAutoQuantizeActive, scaleObj, stageScale, isPlaying } = useContext(
    ProjectContext
  );

  const {
    index,
    volume,
    colorIndex,
    soloedShapeIndices,
    isMuted,
    isVisible,
    isSelected,
    isGroupSelected,
    handleClick,
    handleColorChange,
    handleVolumeChange,
    handleDelete,
    handleSoloChange,
    handleMuteChange,
    handleShapeDuplicate,
    initialPoints,
    initialQuantizeFactor,
    initialNoteEvents,
    startOffset,
    loopDuration,
    handleStartOffsetChange,
    snapToGrid,
    isInViewport,
    // Normalizes note duration for shapes whose content-space units
    // aren't in the usual "pixel-like" musical-canvas magnitude -
    // currently just geographic-mode shapes (ShapeCanvas/Container.jsx's
    // appendShape/importGeoShapes). 1 (no change) for everything else.
    audioScale = 1,
  } = props;

  const [state, setState] = useState({
    points: initialPoints,
    noteEvents: initialNoteEvents || null,
    quantizeFactor: initialQuantizeFactor || 1,
    averagePoint: { x: 0, y: 0 },
    firstNoteIndex: 1,
    noteIndexModifier: 0,
    editorX: 0,
    editorY: 0,
    animCircleX: 0,
    animCircleY: 0,
    panVal: 0,
    // lastCreatedVertexFromMidpoint: 2,
  });

  const {
    points,
    noteEvents,
    noteIndexModifier,
    averagePoint,
    editorX,
    editorY,
    firstNoteIndex,
    quantizeFactor,
    panVal,
    // lastCreatedVertexFromMidpoint,
  } = state;

  const [isHoveredOver, setIsHoveredOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // PlayBar's scrub preview - shows the progress dot at whatever note
  // would start next from the scrubbed/paused position, same dot real
  // playback already uses (see the subscribeToTransportTime effect
  // below). Only relevant while paused; see that effect for why. Driven
  // by plain React props (not the imperative setProgressDotAttrs calls
  // the live-playing path uses) so it's correctly positioned the instant
  // it first appears, with no fresh-mount flash at the Circle's JSX
  // default position.
  const [previewDotPosition, setPreviewDotPosition] = useState(null);
  const shapeRef = useRef();

  const quantizeLength = 500;
  const color = themeColors[colorIndex];
  const isSoloed = soloedShapeIndices.has(index);
  const isAnyShapeSoloed = soloedShapeIndices.size > 0;
  const isEditMode = activeTool === TOOL_TYPES.EDIT;

  const shapeAttrs = useShapeAttrs({
    color,
    isSelected,
    isGroupSelected,
    isMuted,
    isSoloed,
    isAnyShapeSoloed,
    isEditMode,
    isHoveredOver,
  });

  /* 
    Executes every time a note plays.
    Animates the perimeter Dot to move around the shape as it plays
  */
  const isPlayingAnimator = useCallback(
    (val, dur) => {
      // when something else is soloed, this shape is silent - keep it
      // visually still too, instead of animating a shape no one can hear
      if (isAnyShapeSoloed && !isSoloed) {
        return () => {};
      }
      // Well outside the current viewport (ShapeCanvas/Container.jsx's
      // viewport-culling recompute) - the shape itself isn't even drawn
      // right now (Shape/ComponentV2.jsx renders an empty, invisible
      // Group for it), so there's nothing for flashFill/setProgressDot*
      // to visibly affect. Skipping this is the actual point of viewport
      // culling for playback: every note of every off-screen shape was
      // still calling into Konva (setAttrs/.to() tweens), each one
      // requesting a full layer redraw, for changes nobody could ever
      // see - that's what reads as "flickering" on the shapes that ARE
      // visible, since the browser keeps getting asked to repaint for
      // work that has no visible effect.
      if (!isInViewport && !isSelected && !isGroupSelected) {
        return () => {};
      }
      return () => {
        const { pIndex, cursorIndex } = val;

        // Sheet Preview's "follow the shape as it plays" highlight - a
        // no-op if that panel isn't open/mounted (setCurrentNoteIndex is a
        // no-op when nothing's subscribed for this shape index).
        setCurrentNoteIndex(index, cursorIndex);

        const xFrom = points[pIndex - 2];
        const yFrom = points[pIndex - 1];
        const xTo = pIndex >= points.length ? points[0] : points[pIndex];
        const yTo = pIndex >= points.length ? points[1] : points[pIndex + 1];

        const shapeFill = shapeAttrs.fill;
        if (!shapeRef.current) return;
        shapeRef.current.flashFill(shapeFill);
        // these are imperative Konva calls (setAttrs/to), not React props -
        // they bypass whatever radius the <Circle> JSX last rendered
        // entirely, so they need their own counter-scaling against zoom
        // (same reasoning as the JSX radius={6/stageScale} on that Circle)
        // or they render at a fixed content-space size that balloons on
        // screen at high zoom and stays that way until the next note,
        // since nothing else re-applies the scaled value in between.
        shapeRef.current.setProgressDotAttrs({
          x: xFrom,
          y: yFrom,
          fill: appColors.white,
          radius: 8 / stageScale,
        });
        shapeRef.current.setProgressDotTo({
          x: xTo,
          y: yTo,
          duration: dur,
        });
        shapeRef.current.setProgressDotTo({
          radius: 5 / stageScale,
          fill: themeColors[colorIndex],
          duration: 0.3,
        });
      };
    },
    [
      points,
      colorIndex,
      shapeAttrs.fill,
      isAnyShapeSoloed,
      isSoloed,
      stageScale,
      index,
      isInViewport,
      isSelected,
      isGroupSelected,
    ]
  );

  // console.log(panVal);
  const { isBuffering, isSustained, getNoteAtTransportTime } = useShapeSynth({
    index,
    colorIndex,
    volume,
    isPlayingAnimator,
    points,
    noteEvents,
    noteIndexModifier,
    firstNoteIndex,
    isMuted,
    isSoloed,
    isAnyShapeSoloed,
    panVal,
    averagePoint,
    startOffset,
    loopDuration,
    isVisible,
    audioScale,
  });

  // ======================= HOOKS =======================

  useEffect(() => {
    // initializes starting note
    handleDrag();
  }, []);

  useEffect(() => {
    // Real playback (Shape/Synth.js's own per-note callback) already
    // drives the progress dot while isPlaying - this is only for showing
    // where things stand while paused/scrubbing, so skip doing anything
    // while actually playing rather than fight that for no benefit.
    if (isPlaying) {
      setPreviewDotPosition(null);
      return undefined;
    }
    return subscribeToTransportTime(transportSeconds => {
      const noteAtTime = getNoteAtTransportTime(transportSeconds);
      if (!noteAtTime) {
        setPreviewDotPosition(null);
        return;
      }
      // the UPCOMING note - the one that would actually start sounding if
      // playback resumed from here - not the one already mid-flight at
      // this exact instant, which Tone.Part has no way to "catch up" and
      // re-trigger on resume anyway
      const { pIndex } = noteAtTime;
      const x = pIndex >= points.length ? points[0] : points[pIndex];
      const y = pIndex >= points.length ? points[1] : points[pIndex + 1];
      setPreviewDotPosition({ x, y });
    });
  }, [isPlaying, getNoteAtTransportTime, points]);

  useEffect(() => {
    if (!isEditMode) {
      setIsHoveredOver(false);
    }
  }, [isEditMode]);

  useEffect(() => {
    if (isAutoQuantizeActive) {
      setState(s => {
        const newPoints = getPointsForFixedPerimeterLength(
          s.points,
          quantizeLength * s.quantizeFactor
        );

        return { ...s, points: newPoints };
      });
    }
  }, [isAutoQuantizeActive]);

  useImperativeHandle(ref, () => ({
    getSaveDataState: () => {
      return {
        points: getAbsolutePoints(),
        quantizeFactor,
      };
    },
    getMIDINoteEvents: () => {
      // an untouched MIDI import carries its own exact note data - reuse it
      // directly for a lossless re-export instead of re-deriving (lossy)
      // pitches from the shape's geometry
      if (noteEvents && noteEvents.length === points.length / 2) {
        return noteEvents.map(({ midi, duration }) => ({
          note: Math.max(0, Math.min(127, midi)),
          duration,
        }));
      }
      return convertPointsToMIDINoteEvents({
        firstNoteIndex,
        points,
        scaleObj,
        noteIndexModifier,
        audioScale,
      });
    },
    // Sheet Preview's data source (utils/notation.js quantizes/formats
    // this for VexFlow) - mirrors getMIDINoteEvents above, but keeps the
    // full Teoria note (correct sharp/flat spelling in the project's key)
    // instead of collapsing to a MIDI number. For an untouched MIDI import
    // there's no scale degree to spell from, so it falls back to a plain
    // chromatic spelling of the imported MIDI number.
    getNotationNoteEvents: () => {
      if (noteEvents && noteEvents.length === points.length / 2) {
        return noteEvents.map(({ midi, duration }) => ({
          teoriaNote: Teoria.note.fromMIDI(Math.max(0, Math.min(127, midi))),
          duration,
        }));
      }
      return convertPointsToNoteEvents({
        firstNoteIndex,
        points,
        scaleObj,
        noteIndexModifier,
        audioScale,
      });
    },
    // Forwarded straight through to ComponentV2's own handle - viewport
    // culling's recompute (ShapeCanvas/Container.jsx) calls this on
    // whatever ref ShapesWrapper.jsx holds, which is THIS component's
    // handle, not ComponentV2's directly. This handle is a curated
    // allowlist (see the other methods above), not a passthrough, so a
    // new method added to ComponentV2 has to be re-exposed here too or
    // it's simply unreachable from outside.
    getContentBounds: () => shapeRef.current.getContentBounds(),
  }));

  // ====================== HANDLERS ======================

  /* Hover */
  const handleMouseDown = e => {
    setState(s => ({ ...s, editorX: e.evt.offsetX, editorY: e.evt.offsetY }));
  };

  /* Drag */
  const handleDrag = e => {
    // console.log('handleMouseMove');
    // const { lastCreatedVertexFromMidpoint } = state;
    // if (e && lastCreatedVertexFromMidpoint > -1) {
    //   console.log(e);
    //   handleVertexDragMove(lastCreatedVertexFromMidpoint)(e);
    //   return;
    // }

    setState(s => {
      // Content-space position (relative to the Layer, NOT the Stage's
      // own zoom/pan transform) - deliberately not getAbsolutePosition(),
      // which includes the Stage's scale/position and previously meant
      // zooming or panning the canvas silently changed a shape's pitch
      // (and stereo pan, and Proximity Mode's 3D position - all three are
      // derived from this same point) even though the shape itself never
      // moved within the actual composition.
      const contentPos = shapeRef.current.getPosition();
      const avgPoint = getAveragePoint(s.points);
      const x = parseInt(contentPos.x + avgPoint.x, 10);
      const y = parseInt(contentPos.y + avgPoint.y, 10);
      const panVal = convertValToRange(x, 0, getCanvasWidth(), -1, 1);
      const noteIndexVal = parseInt(
        convertValToRange(
          y,
          0,
          PITCH_MODIFIER_SPAN_PX,
          PITCH_MODIFIER_MAX,
          PITCH_MODIFIER_MIN
        ),
        10
      );
      return {
        ...s,
        panVal,
        averagePoint: { x, y },
        noteIndexModifier: noteIndexVal,
      };
    });
  };
  //
  // const handleMouseMove = e => {
  //   console.log('handleMouseMove');
  //   const { lastCreatedVertexFromMidpoint } = state;
  //   if (e && lastCreatedVertexFromMidpoint > -1) {
  //     handleVertexDragMove(lastCreatedVertexFromMidpoint)(e);
  //     // return;
  //   }
  // };

  const dragBoundFunc = ({ x, y }) => {
    return {
      x: snapToGrid(x),
      y: snapToGrid(y),
    };
  };

  const handleVertexDragMove = i => e => {
    setState(s => {
      const { x, y } = e.target.position();
      // console.log(x, y);
      let points = s.points.slice();
      points[i] = snapToGrid(x);
      points[i + 1] = snapToGrid(y);

      if (isAutoQuantizeActive) {
        points = getPointsForFixedPerimeterLength(
          points,
          quantizeLength * s.quantizeFactor
        );
      }
      return { ...s, points };
    });
  };

  const handleVertexDelete = i => e => {
    setState(s => {
      let points = s.points.slice();
      /* Only delete if we have more than two points */
      if (points.length <= 2 * 2) return s;

      /* remove x and y points */
      points.splice(i, 2);

      if (isAutoQuantizeActive) {
        points = getPointsForFixedPerimeterLength(
          points,
          quantizeLength * s.quantizeFactor
        );
      }
      return { ...s, points };
    });
  };

  /* Create new point at midpoint of previous and next points*/
  const handleVertexAdd = i => e => {
    setState(s => {
      let points = s.points.slice();
      const x = points[i];
      const y = points[i + 1];
      const nextX = points[i + 2] || points[0];
      const nextY = points[i + 3] || points[1];
      const newX = (x + nextX) / 2;
      const newY = (y + nextY) / 2;

      /* remove x and y points */
      points.splice(i + 2, 0, ...[newX, newY]);

      if (isAutoQuantizeActive) {
        points = getPointsForFixedPerimeterLength(
          points,
          quantizeLength * s.quantizeFactor
        );
      }
      return { ...s, points };
    });
  };

  const resetHover = () => {
    // hack to update Konva layout following imperative changes
    setIsHoveredOver(true);
    setIsHoveredOver(false);
  };

  const handleToTopClick = () => {
    shapeRef.current.moveToTop();
    resetHover();
  };

  const handleToBottomClick = () => {
    shapeRef.current.moveToBottom();
    resetHover();
  };

  const handleQuantizeFactorChange = factor => () => {
    setState(s => {
      const { points, quantizeFactor } = s;
      if (
        (factor < 1 && quantizeFactor >= 0.25) ||
        (factor > 1 && quantizeFactor <= 4)
      ) {
        const newPerim = isAutoQuantizeActive
          ? factor * quantizeFactor * quantizeLength
          : getPerimeterLength(points) * factor;
        const newPoints = getPointsForFixedPerimeterLength(points, newPerim);
        return {
          ...s,
          points: newPoints,
          quantizeFactor: factor * quantizeFactor,
        };
      }
      return s;
    });
  };

  const getAbsolutePoints = () => {
    const { x, y } = shapeRef.current.getAbsolutePosition();
    const absolutePoints = points.map((p, i) => (i % 2 === 0 ? p + x : p + y));
    return absolutePoints;
  };

  const handleReverseClick = () => {
    setState(s => {
      const { points, noteEvents } = s;
      const reversed = [points[0], points[1]];
      for (let i = points.length - 2; i >= 2; i -= 2) {
        reversed.push(points[i]);
        reversed.push(points[i + 1]);
      }
      // keep absolute-mode note order in lockstep with the reversed sweep
      // direction, so playback order still matches what's drawn
      const reversedNoteEvents = noteEvents
        ? [noteEvents[0], ...noteEvents.slice(1).reverse()]
        : noteEvents;
      return { ...s, points: reversed, noteEvents: reversedNoteEvents };
    });
  };

  return (
    <ShapeComponent
      // TODO: revisit ref methods
      ref={shapeRef}
      index={index}
      points={points}
      attrs={shapeAttrs}
      volume={volume}
      colorIndex={colorIndex}
      noteIndexModifier={noteIndexModifier}
      isDragging={isDragging}
      isSelected={isSelected}
      isGroupSelected={isGroupSelected}
      isMuted={isMuted}
      isVisible={isVisible}
      isSoloed={isSoloed}
      isBuffering={isBuffering}
      isSustained={isSustained}
      noteEvents={noteEvents}
      startOffset={startOffset || 0}
      previewDotPosition={previewDotPosition}
      isInViewport={isInViewport}
      averagePoint={averagePoint}
      editorPosition={{ x: editorX, y: editorY }}
      // shape event handlers
      // draggable={lastCreatedVertexFromMidpoint < -1}
      draggable
      dragBoundFunc={dragBoundFunc}
      handleDrag={handleDrag}
      // handleMouseMove={handleMouseMove}
      handleDragStart={() => setIsDragging(true)}
      handleDragEnd={() => setIsDragging(false)}
      handleClick={e => {
        // pass points if needed for duplication
        const absolutePoints = getAbsolutePoints();
        handleClick(index, absolutePoints, e && e.evt && e.evt.shiftKey);
      }}
      handleMouseDown={handleMouseDown}
      handleMouseOver={() => setIsHoveredOver(true)}
      handleMouseOut={() => setIsHoveredOver(false)}
      handleVertexDragMove={handleVertexDragMove}
      handleVertexDelete={handleVertexDelete}
      handleVertexAdd={handleVertexAdd}
      // editor panel handlers
      handleColorChange={handleColorChange}
      handleDelete={handleDelete}
      handleQuantizeFactorChange={handleQuantizeFactorChange}
      handleVolumeChange={handleVolumeChange(index)}
      handleStartOffsetChange={handleStartOffsetChange(index)}
      handleMuteChange={handleMuteChange(index)}
      handleSoloChange={() => handleSoloChange(index)}
      handleToTopClick={handleToTopClick}
      handleToBottomClick={handleToBottomClick}
      handleReverseClick={handleReverseClick}
      handleDuplicateClick={() => {
        // pass points if needed for duplication
        const absolutePoints = getAbsolutePoints();
        handleShapeDuplicate(index, absolutePoints);
      }}
    />
  );
}

export default memo(forwardRef(ShapeContainerV2));
