import { themeColors } from 'utils/color';

const TRACE_MAX_DIMENSION = 500;
const MIN_BLOB_AREA_RATIO = 0.0008;
const MIN_HOLE_AREA_RATIO = 0.0003;
const MAX_POLYGON_VERTICES = 24;
// Not a creative limit - trace every detected shape. This is purely a
// browser-safety backstop against a pathological image (e.g. a noisy photo
// producing thousands of tiny regions) hanging the tab.
const MAX_SHAPES_PER_TRACE = 500;
const SIMPLIFICATION_EPSILON_RATIO = 0.02;
const MIN_VOLUME = -18;
const MAX_VOLUME = 0;

const clamp01 = val => Math.max(0, Math.min(1, val));

const THEME_COLOR_RGB = themeColors.map(hex => ({
  r: parseInt(hex.substring(1, 3), 16),
  g: parseInt(hex.substring(3, 5), 16),
  b: parseInt(hex.substring(5, 7), 16),
}));

function findNearestThemeColorIndex(avgR, avgG, avgB) {
  let bestIndex = 0;
  let bestDistSq = Infinity;
  THEME_COLOR_RGB.forEach(({ r, g, b }, i) => {
    const distSq = (r - avgR) ** 2 + (g - avgG) ** 2 + (b - avgB) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
    }
  });
  return bestIndex;
}

/* Averages a set of pixels' real RGB (-> nearest instrument color) and
   grayscale darkness (-> volume, darker ink is louder). Used directly on a
   foreground blob's own pixels, or on the ink pixels bordering a hole (see
   getForegroundNeighborSamples) since a hole's own pixels are background. */
function colorAndVolumeFromSamples(sampleIndices, imageData, gray) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumGray = 0;
  for (const idx of sampleIndices) {
    sumR += imageData.data[idx * 4];
    sumG += imageData.data[idx * 4 + 1];
    sumB += imageData.data[idx * 4 + 2];
    sumGray += gray[idx];
  }
  const n = sampleIndices.length;
  const colorIndex = findNearestThemeColorIndex(sumR / n, sumG / n, sumB / n);
  const avgGray = sumGray / n;
  const darkness = 1 - avgGray / 255;
  const volume = MIN_VOLUME + darkness * (MAX_VOLUME - MIN_VOLUME);
  return { colorIndex, volume };
}

/* The foreground (ink) pixels immediately bordering a set of pixels - used
   to sample a hole's surrounding ink color/darkness, since the hole's own
   pixels are background (would just sample as white). */
function getForegroundNeighborSamples(pixels, mask, width, height) {
  const samples = new Set();
  for (const idx of pixels) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    const neighbors = [];
    if (x > 0) neighbors.push(idx - 1);
    if (x < width - 1) neighbors.push(idx + 1);
    if (y > 0) neighbors.push(idx - width);
    if (y < height - 1) neighbors.push(idx + width);
    for (const n of neighbors) {
      if (mask[n] === 1) samples.add(n);
    }
  }
  return Array.from(samples);
}

/* Spreads the kept shapes evenly across the whole scanned area instead of
   just keeping the biggest blobs (which can all cluster in one region) -
   bucket by centroid into a grid, keep each occupied cell's largest blob,
   then backfill any remaining slots with the next-largest leftover blobs. */
function sampleComponentsSpatially(components, width, height, maxCount) {
  if (components.length <= maxCount) return components;

  const gridSize = Math.max(1, Math.ceil(Math.sqrt(maxCount)));
  const cells = new Map();

  components.forEach(pixels => {
    let sumX = 0;
    let sumY = 0;
    for (const idx of pixels) {
      sumX += idx % width;
      sumY += Math.floor(idx / width);
    }
    const centroidX = sumX / pixels.length;
    const centroidY = sumY / pixels.length;
    const cellX = Math.min(gridSize - 1, Math.floor((centroidX / width) * gridSize));
    const cellY = Math.min(gridSize - 1, Math.floor((centroidY / height) * gridSize));
    const key = `${cellX},${cellY}`;

    const existing = cells.get(key);
    if (!existing || pixels.length > existing.length) {
      cells.set(key, pixels);
    }
  });

  let representatives = Array.from(cells.values());
  if (representatives.length > maxCount) {
    representatives = representatives
      .slice()
      .sort((a, b) => b.length - a.length)
      .slice(0, maxCount);
  } else if (representatives.length < maxCount) {
    const representativeSet = new Set(representatives);
    const leftovers = components
      .filter(pixels => !representativeSet.has(pixels))
      .sort((a, b) => b.length - a.length);
    representatives = representatives.concat(
      leftovers.slice(0, maxCount - representatives.length)
    );
  }

  return representatives;
}

/*
  Draws `imageEl` onto an offscreen canvas downscaled to TRACE_MAX_DIMENSION,
  optionally cropped to regionRect (0..1 UV space, relative to the whole image).
  Returns the cropped ImageData plus enough info to map local pixel
  coordinates back to 0..1 UV space relative to the *whole* downscaled image.
*/
function getImageData(imageEl, regionRect) {
  const naturalWidth = imageEl.naturalWidth || imageEl.width;
  const naturalHeight = imageEl.naturalHeight || imageEl.height;
  const scale = Math.min(
    1,
    TRACE_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight)
  );
  const fullWidth = Math.max(1, Math.round(naturalWidth * scale));
  const fullHeight = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = fullWidth;
  canvas.height = fullHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageEl, 0, 0, fullWidth, fullHeight);

  if (!regionRect) {
    return {
      imageData: ctx.getImageData(0, 0, fullWidth, fullHeight),
      width: fullWidth,
      height: fullHeight,
      offsetX: 0,
      offsetY: 0,
      fullWidth,
      fullHeight,
    };
  }

  const rx = clamp01(regionRect.x);
  const ry = clamp01(regionRect.y);
  const rw = clamp01(regionRect.x + regionRect.width) - rx;
  const rh = clamp01(regionRect.y + regionRect.height) - ry;

  const offsetX = Math.round(rx * fullWidth);
  const offsetY = Math.round(ry * fullHeight);
  const width = Math.min(fullWidth - offsetX, Math.max(1, Math.round(rw * fullWidth)));
  const height = Math.min(fullHeight - offsetY, Math.max(1, Math.round(rh * fullHeight)));

  return {
    imageData: ctx.getImageData(offsetX, offsetY, width, height),
    width,
    height,
    offsetX,
    offsetY,
    fullWidth,
    fullHeight,
  };
}

function toGrayscale({ data, width, height }) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

/* Otsu's method: picks a threshold that best separates the image into two classes. */
function otsuThreshold(gray) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let weightB = 0;
  let maxBetweenClassVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const betweenClassVariance = weightB * weightF * (meanB - meanF) * (meanB - meanF);

    if (betweenClassVariance > maxBetweenClassVariance) {
      maxBetweenClassVariance = betweenClassVariance;
      threshold = t;
    }
  }
  return threshold;
}

/* Foreground = whichever class (above/below threshold) is the minority -
   a drawn shape is usually the smaller region against a larger background. */
function buildBinaryMask(gray, threshold) {
  const n = gray.length;
  let belowCount = 0;
  for (let i = 0; i < n; i++) {
    if (gray[i] <= threshold) belowCount++;
  }
  const foregroundIsBelow = belowCount <= n - belowCount;

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const isBelow = gray[i] <= threshold;
    mask[i] = isBelow === foregroundIsBelow ? 1 : 0;
  }
  return mask;
}

/* 4-connected flood fill labeling. Returns an array of pixel-index arrays, one per blob. */
function findConnectedComponents(mask, width, height, minArea) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pixels = [];

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);

      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);

      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (mask[n] === 1 && !visited[n]) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    if (pixels.length >= minArea) {
      components.push(pixels);
    }
  }
  return components;
}

/*
  4-connected flood fill over the BACKGROUND (mask === 0). A background
  region that never touches the scanned area's own border is fully enclosed
  by foreground - a "hole" (e.g. the gap between two touching ink shapes).
  Tracing these recovers interior detail that's otherwise invisible: a dense
  pattern's ink is often all one connected blob (shapes touching each other),
  so only its outer silhouette would ever get traced without this.
*/
function findEnclosedHoles(mask, width, height, minArea) {
  const visited = new Uint8Array(mask.length);
  const holes = [];
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 0 || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pixels = [];
    let touchesBorder = false;

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);

      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (mask[n] === 0 && !visited[n]) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    if (!touchesBorder && pixels.length >= minArea) {
      holes.push(pixels);
    }
  }
  return holes;
}

function findStartPixel(pixels, width) {
  let best = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const idx = pixels[i];
    const y = Math.floor(idx / width);
    const by = Math.floor(best / width);
    if (y < by || (y === by && idx % width < best % width)) {
      best = idx;
    }
  }
  return { x: best % width, y: Math.floor(best / width) };
}

const isForegroundAt = (blobMask, width, height, x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  return blobMask[y * width + x] === 1;
};

/* Moore-neighbor ("square tracing") boundary follower, clockwise. */
function traceBoundary(blobMask, width, height, startX, startY) {
  const DIRS = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
  ]; // N, NE, E, SE, S, SW, W, NW

  const boundary = [[startX, startY]];
  let backtrackDir = 6; // W - start searching from N, clockwise
  let current = [startX, startY];
  const maxIterations = (width + height) * 8 + 1000;
  let iterations = 0;

  while (iterations++ < maxIterations) {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dirIndex = (backtrackDir + 1 + i) % 8;
      const [dx, dy] = DIRS[dirIndex];
      const nx = current[0] + dx;
      const ny = current[1] + dy;
      if (isForegroundAt(blobMask, width, height, nx, ny)) {
        backtrackDir = (dirIndex + 4) % 8;
        current = [nx, ny];
        found = true;
        break;
      }
    }
    if (!found) break; // isolated single pixel
    if (current[0] === startX && current[1] === startY) break; // back to start
    boundary.push(current);
  }
  return boundary;
}

function perpendicularDistance(point, lineStart, lineEnd) {
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

function douglasPeucker(points, epsilon) {
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

function simplifyToMaxVertices(points, initialEpsilon, maxVertices) {
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

function getBoundingBoxDiagonal(points) {
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

/* Maps region-local pixel points back to 0..1 UV space relative to the whole image. */
function normalizePoints(points, offsetX, offsetY, fullWidth, fullHeight) {
  const flat = [];
  for (const [x, y] of points) {
    flat.push((offsetX + x) / fullWidth);
    flat.push((offsetY + y) / fullHeight);
  }
  return flat;
}

/*
  Detects distinct high-contrast shapes in `imageEl` and returns one
  { points, colorIndex, volume } per shape - `points` a flat [x0,y0,x1,y1,...]
  polygon in 0..1 UV space relative to the whole image; `colorIndex` the
  closest-matching theme/instrument color sampled near that shape's actual
  pixels; `volume` derived from how dark/dense the ink there is. Also returns
  `totalFound` (may exceed the returned shape count - see MAX_SHAPES_PER_TRACE
  below). `regionRect` ({x,y,width,height}, also 0..1 UV space) restricts
  detection to a sub-area of the image; omit/null to scan the whole image.

  Detects two kinds of regions: foreground ink blobs (outer silhouettes) AND
  enclosed background "holes" fully surrounded by ink (e.g. the gap between
  two touching shapes in a dense pattern). A continuous pattern's ink is
  often all one connected blob, so without hole detection only its outer
  edge would ever get traced - the holes are what recover interior detail.
*/
export function traceShapesFromImage({ imageEl, regionRect }) {
  const {
    imageData,
    width,
    height,
    offsetX,
    offsetY,
    fullWidth,
    fullHeight,
  } = getImageData(imageEl, regionRect);

  const gray = toGrayscale(imageData);
  const threshold = otsuThreshold(gray);
  const mask = buildBinaryMask(gray, threshold);

  const minBlobArea = Math.max(8, Math.round(width * height * MIN_BLOB_AREA_RATIO));
  const blobs = findConnectedComponents(mask, width, height, minBlobArea);

  const minHoleArea = Math.max(6, Math.round(width * height * MIN_HOLE_AREA_RATIO));
  const holes = findEnclosedHoles(mask, width, height, minHoleArea);
  const holeSet = new Set(holes);

  const allRegions = blobs.concat(holes);
  const totalFound = allRegions.length;

  // A dense pattern (e.g. a repeating decorative texture) can produce far
  // more distinct regions than are useful as individual playable shapes -
  // keep a sample spread evenly across the whole image (not just the
  // biggest ones, which can all cluster together) so the canvas doesn't get
  // flooded; Select Area lets you drill into a smaller region for the rest.
  const sampledRegions = sampleComponentsSpatially(
    allRegions,
    width,
    height,
    MAX_SHAPES_PER_TRACE
  );

  const shapes = [];
  for (const pixels of sampledRegions) {
    const blobMask = new Uint8Array(width * height);
    for (const idx of pixels) blobMask[idx] = 1;

    const { x: startX, y: startY } = findStartPixel(pixels, width);
    const boundary = traceBoundary(blobMask, width, height, startX, startY);
    if (boundary.length < 3) continue;

    const bboxDiagonal = getBoundingBoxDiagonal(boundary);
    const epsilon = Math.max(1, bboxDiagonal * SIMPLIFICATION_EPSILON_RATIO);
    const simplified = simplifyToMaxVertices(boundary, epsilon, MAX_POLYGON_VERTICES);
    if (simplified.length < 3) continue;

    const isHole = holeSet.has(pixels);
    const samples = isHole
      ? getForegroundNeighborSamples(pixels, mask, width, height)
      : pixels;
    const { colorIndex, volume } = samples.length
      ? colorAndVolumeFromSamples(samples, imageData, gray)
      : { colorIndex: 0, volume: MIN_VOLUME };

    shapes.push({
      points: normalizePoints(simplified, offsetX, offsetY, fullWidth, fullHeight),
      colorIndex,
      volume,
    });
  }

  return { shapes, totalFound };
}
