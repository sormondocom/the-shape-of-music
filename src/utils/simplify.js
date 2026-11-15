/*
  Douglas-Peucker polyline simplification - shared by utils/imageTrace.js
  (traced shape outlines) and utils/geoTrackImport.js (imported GPS/GIS
  tracks). Operates on plain [x, y] point pairs; callers own whatever
  coordinate space those are in (traced-image pixels, projected world
  pixels, raw lat/lon - DP's own geometry doesn't care).
*/

export function perpendicularDistance(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / lengthSq;
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

// Recursion depth tracks how many times a segment gets split, which is
// bounded by how many points survive - safe as long as callers keep input
// sizes in the thousands, not hundreds of thousands (see
// uniformPreSample below, used for exactly this reason by anything that
// might otherwise hand this a raw, undecimated import).
export function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

export function getBoundingBoxDiagonal(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

// Repeatedly loosens epsilon until the result fits maxVertices - used
// where a hard vertex ceiling matters more than hitting an exact
// epsilon (utils/imageTrace.js's MAX_POLYGON_VERTICES).
export function simplifyToMaxVertices(points, initialEpsilon, maxVertices) {
  let epsilon = initialEpsilon;
  let simplified = douglasPeucker(points, epsilon);
  let iterations = 0;
  while (simplified.length > maxVertices && iterations < 12) {
    epsilon *= 1.5;
    simplified = douglasPeucker(points, epsilon);
    iterations++;
  }
  return simplified;
}

// Same loosening search, but in RATIO space (epsilon / bounding-box
// diagonal) rather than absolute units - scale-independent, so it works
// as a slider value that means roughly the same thing regardless of a
// given shape's real size. Returns the smallest ratio that gets `points`
// under maxVertices, for use as a safe lower bound (GeoSimplifyPreviewModal's
// slider never lets the user pick something that would still be too dense).
export function findMinRatioForMaxVertices(points, maxVertices, startRatio = 0.0005) {
  const diagonal = getBoundingBoxDiagonal(points);
  if (diagonal === 0) return startRatio;
  let ratio = startRatio;
  let simplified = douglasPeucker(points, diagonal * ratio);
  let iterations = 0;
  while (simplified.length > maxVertices && iterations < 20) {
    ratio *= 1.5;
    simplified = douglasPeucker(points, diagonal * ratio);
    iterations++;
  }
  return ratio;
}

// Cheap, even-stride reduction - NOT a substitute for douglasPeucker's
// shape-aware simplification, only a safety bound on its INPUT size.
// DP's recursion depth and O(n log n)-ish cost both scale with point
// count, so a raw import with hundreds of thousands of points has to be
// cut down to something DP can chew on quickly (interactively, for
// GeoSimplifyPreviewModal's slider) before DP ever sees it. Always keeps
// the first and last point.
export function uniformPreSample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}
