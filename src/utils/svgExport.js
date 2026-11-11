import { themeColors } from 'utils/color';

/*
  Renders the composition's shapes as a flat vector "line art" image - just
  each shape's own-colored outline, no fill, sized to fit the whole
  composition regardless of whatever zoom/pan the canvas happens to be at
  right now. That's deliberately different from a screenshot of the live
  Stage, which would also pick up grid lines, selection handles, the
  playback progress dot, and the scrollbar/zoom badge, and would crop to
  whatever's currently in the viewport rather than the whole piece.

  Hidden shapes (LayersPanel's visibility toggle) are left out entirely,
  same as they already are on the canvas itself. Muted shapes stay in but
  fainter, mirroring the on-canvas opacity convention
  (Shape/useShapeAttrs.js's mute dimming) so the exported image still
  reads as "this one's quieter" rather than silently dropping it.

  Returns null if there's nothing visible to export - the caller decides
  how to tell the user that.
*/

// how much empty margin to leave around the composition, as a fraction of
// its own diagonal (so a tiny sketch and a sprawling one both get a
// proportionally similar amount of breathing room, not a flat pixel count)
const PADDING_FRACTION = 0.08;

export const buildLineArtSVG = shapesList => {
  const shapes = shapesList.filter(shape => shape.isVisible !== false);
  if (!shapes.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  shapes.forEach(({ points }) => {
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
  });

  const rawWidth = Math.max(1, maxX - minX);
  const rawHeight = Math.max(1, maxY - minY);
  const diagonal = Math.hypot(rawWidth, rawHeight);
  const padding = diagonal * PADDING_FRACTION;
  const width = rawWidth + padding * 2;
  const height = rawHeight + padding * 2;
  const offsetX = padding - minX;
  const offsetY = padding - minY;

  // proportional to the whole composition's own scale, not a flat SVG
  // unit count, so the line reads at a consistent relative weight whether
  // the shapes' coordinate space happens to be tiny or sprawling
  const strokeWidth = Math.max(1, Math.min(8, diagonal * 0.003));

  const polygons = shapes
    .map(({ points, colorIndex, isMuted }) => {
      const color = themeColors[colorIndex] || '#333333';
      const coords = [];
      for (let i = 0; i < points.length; i += 2) {
        coords.push(
          `${(points[i] + offsetX).toFixed(2)},${(points[i + 1] + offsetY).toFixed(2)}`
        );
      }
      return (
        `  <polygon points="${coords.join(' ')}" fill="none" stroke="${color}" ` +
        `stroke-width="${strokeWidth.toFixed(2)}" stroke-opacity="${isMuted ? 0.35 : 1}" ` +
        `stroke-linejoin="round" stroke-linecap="round" />`
      );
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(
      0
    )}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">\n` +
    `${polygons}\n` +
    `</svg>\n`
  );
};
