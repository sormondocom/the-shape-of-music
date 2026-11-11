/*
  Zoom-aware vertex decimation for a shape's EDITING affordances only -
  vertex/midpoint drag handles, and per-edge overlays like the sustained-
  note tick marks and the rest-dash segments. Never the shape's own
  outline/fill Line, which always draws every real point at every zoom -
  this is purely about how many extra interactive/decorative Konva nodes
  get mounted on top of it.

  A dense MIDI import (no cap on note count any more - see
  utils/midiImport.js) can hand a single shape thousands of vertices.
  Each vertex/midpoint handle is its own Konva node (hit region, drag/
  click bindings, counter-scaled radius) - at low zoom, where dozens of
  them can land within a few screen pixels of each other, rendering a
  full interactive handle for every single one is usually the actual
  performance bottleneck, not the shape's line itself (one Line with many
  points is cheap for Canvas2D; hundreds of separate interactive nodes
  are not). None of this touches any point's real data, or what the
  drawn shape looks like - only which vertices get a handle/overlay this
  render. Zooming in only ever reveals more (the screen-pixel threshold
  maps to a smaller content-space gap), never permanently hides anything.
*/

const DEFAULT_MIN_SCREEN_GAP_PX = 8;
// A tighter threshold for the shape's own drawn outline/fill than for
// handles - this is what's actually visible as "the shape", not just an
// editing affordance on top of it, so it stays closer to full fidelity
// while still collapsing truly sub-pixel clustering (which is, by
// construction, never visually distinguishable from the full-detail
// version on any display).
const OUTLINE_MIN_SCREEN_GAP_PX = 2;

// Greedy single pass: walk vertices in order, keep one only once it's at
// least minScreenGapPx (converted to content-space via the current zoom)
// away from the last KEPT vertex - not the last vertex overall, so a long
// run of tightly-clustered points doesn't each individually "almost"
// clear the threshold and all get kept anyway. Always keeps the first and
// last vertex (the last is where the shape's closing edge lands, and
// matters for that edge's own midpoint/overlay even if it's close to the
// first).
const decimateIndices = (points, stageScale, minScreenGapPx) => {
  const count = points.length / 2;
  const indices = [];
  if (count === 0) return indices;
  indices.push(0);
  if (count === 1) return indices;

  const minContentGap = minScreenGapPx / (stageScale || 1);
  const minContentGapSq = minContentGap * minContentGap;

  let lastX = points[0];
  let lastY = points[1];

  for (let i = 1; i < count; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const dx = x - lastX;
    const dy = y - lastY;
    const isLast = i === count - 1;
    if (isLast || dx * dx + dy * dy >= minContentGapSq) {
      indices.push(i);
      lastX = x;
      lastY = y;
    }
  }
  return indices;
};

export const getDecimatedVertexIndices = (
  points,
  stageScale,
  minScreenGapPx = DEFAULT_MIN_SCREEN_GAP_PX
) => new Set(decimateIndices(points, stageScale, minScreenGapPx));

/*
  Same decimation, but returns an actual flat [x0,y0,x1,y1,...] points
  array - for the shape's own drawn outline/fill Line itself, not just
  its editing handles. This is the part that matters most for raw canvas
  repaint cost: a Konva Line with thousands of points means thousands of
  real lineTo() calls the browser's Canvas2D has to replay on every frame
  the view changes (pan/zoom), independent of whether React re-rendered
  anything - memoizing the JSX (as the handles/overlays already are)
  doesn't touch this cost at all, since Konva still has to repaint actual
  pixels at the new scale. Collapsing near-duplicate points before they
  ever reach the Line's `points` prop is what actually reduces that work.
  Never used for anything audio/geometry/export-related - only this one
  Line's own `points` prop, swapped in by Shape/ComponentV2.jsx.
*/
export const getDecimatedPoints = (
  points,
  stageScale,
  minScreenGapPx = OUTLINE_MIN_SCREEN_GAP_PX
) => {
  const indices = decimateIndices(points, stageScale, minScreenGapPx);
  if (indices.length === points.length / 2) return points;
  const result = [];
  indices.forEach(i => {
    result.push(points[i * 2], points[i * 2 + 1]);
  });
  return result;
};

// A shape's own content-space bounding box, from its flat [x0,y0,x1,y1,...]
// points - used for viewport culling (Shape/ComponentV2.jsx's
// getContentBounds). Deliberately computed from the live points a shape
// already holds in its own state, not anything cached centrally - that
// stays correct through drags/edits with no invalidation bookkeeping, and
// keeps working even while a shape is culled (visually stripped to an
// empty, invisible Group - see ComponentV2.jsx), so it can still be
// found again once the viewport comes back around to it.
export const getPointsBounds = points => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

// AABB overlap test between a shape's own bounds (already offset into
// content space - see getContentBounds) and the current viewport rect.
export const boundsIntersectRect = (bounds, rect) =>
  bounds.maxX >= rect.minX &&
  bounds.minX <= rect.maxX &&
  bounds.maxY >= rect.minY &&
  bounds.minY <= rect.maxY;
