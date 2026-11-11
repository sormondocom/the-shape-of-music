/*
  Shared math for the canvas pan scrollbars (ShapeCanvas/PanScrollbar) - used
  both to render the thumb (Container.jsx computes fractions from the
  current stageScale/stagePos on every render) and to convert a dragged/
  clicked fraction back into a stagePos value.

  The "world" is a fixed, content-space box the scrollbar represents - not
  derived from actual shape bounds (simpler/predictable): 3x the visible
  canvas size on each axis, centered on (canvasSize/2) - the same point
  insertPresetShape/MIDI import already center new shapes on.
*/

export const WORLD_SIZE_MULTIPLIER = 3;
export const MIN_THUMB_FRACTION = 0.05;

export const getWorldBoundsForAxis = canvasSize => ({
  worldMin: -canvasSize,
  worldSize: canvasSize * WORLD_SIZE_MULTIPLIER,
});

// current thumb size/position, as fractions of the track (0-1)
export const getScrollbarMetrics = ({ stagePosAxis, stageScale, canvasSize }) => {
  const { worldMin, worldSize } = getWorldBoundsForAxis(canvasSize);
  const viewportContentSize = canvasSize / stageScale;
  const thumbFraction = Math.max(
    MIN_THUMB_FRACTION,
    Math.min(1, viewportContentSize / worldSize)
  );
  const viewportStart = -stagePosAxis / stageScale;
  const range = worldSize - viewportContentSize;
  const positionFraction =
    range > 0 ? Math.max(0, Math.min(1, (viewportStart - worldMin) / range)) : 0;
  return { thumbFraction, positionFraction };
};

// inverse: a thumb-position fraction (0-1) -> the stagePos value that puts
// the viewport there
export const getStagePosFromFraction = ({ fraction, stageScale, canvasSize }) => {
  const { worldMin, worldSize } = getWorldBoundsForAxis(canvasSize);
  const viewportContentSize = canvasSize / stageScale;
  const range = Math.max(0, worldSize - viewportContentSize);
  const viewportStart = worldMin + Math.max(0, Math.min(1, fraction)) * range;
  return -viewportStart * stageScale;
};
