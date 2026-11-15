/*
  Turns a GPS/GIS vector file (GPX, KML, or GeoJSON - the common export
  formats for flight routes, hiking tracks, ship routes, survey points,
  etc) into shape points, projected into the exact same world-pixel space
  the OSM base layer's tiles live in (utils/geoTiles.js) - so an imported
  route lands exactly where it really is on the map underneath it, rather
  than at some arbitrary on-canvas position.

  Deliberately does NOT try to build its own note/pitch mapping the way
  utils/midiImport.js's absolute-mode noteEvents does - a GPS track has
  no inherent pitch data to preserve, so there's nothing to bypass the
  geometry for. These points are handed to a shape exactly like a hand-
  drawn one: the app's own existing turn-angle -> scale-degree and
  Y-position -> transposition logic (utils/shape.js's getNoteInfo)
  derives the music from the route's own shape, same as it would for
  anything else drawn on the canvas. That's the whole point - a flight
  route gets "heard" using the same strategy as any other shape, just
  sourced from real geographic coordinates instead of a mouse drag.

  Each format can describe more than just connected tracks/lines:
  standalone points (GPX waypoints, KML Points, GeoJSON Point features)
  have no path of their own, so every standalone point found in a file is
  collected into ONE shared "connect the dots" shape, in document order -
  letting a scatter of waypoints become a single audible shape instead of
  being silently dropped (a lone point can't form a shape by itself).
  Polygons (KML, GeoJSON) are split into one shape per ring (outer
  boundary and any holes alike) - the hole/outer distinction doesn't
  matter once it's just "a shape to hear", only the point sequence does.

  Uses only browser-native parsing (DOMParser for GPX/KML's XML,
  JSON.parse for GeoJSON) - no new dependency needed for any of the three
  formats. (Shapefile import - utils/shapefileImport.js - is binary and
  needs its own parser, but produces the same { lat, lon } track shape
  this file's parsers do, and is converted to points via the same
  toPoints below.)
*/

import { lonLatToWorldPixel } from './geoTiles';
import {
  douglasPeucker,
  findMinRatioForMaxVertices,
  getBoundingBoxDiagonal,
  uniformPreSample,
} from './simplify';

const isValidLatLon = ({ lat, lon }) => !isNaN(lat) && !isNaN(lon);

// A last-resort backstop, not the real complexity control (getMaxPointsPerTrack
// below is) - a truly pathological file (a nationwide block-level shapefile
// with hundreds of thousands of features) still needs a hard ceiling on
// feature COUNT, since no amount of per-shape point reduction changes how
// many Tone.Parts and Konva nodes get mounted. Real county/subdivision-level
// files (low thousands of features) never hit this; dropping whole shapes
// to enforce a LOW count was the previous approach here and it's wrong for
// exactly that common case - a shapefile missing most of its counties
// doesn't look like the state it's supposed to be anymore. Same guard/
// pattern as utils/imageTrace.js's MAX_SHAPES_PER_TRACE, much higher number.
export const MAX_IMPORTED_GEO_SHAPES = 5000;

// The real complexity control: every shape in an import shares ONE total
// point budget, split evenly across however many shapes there actually
// are - a file with 3 features each keep up to ABSOLUTE_MAX_POINTS_PER_TRACK
// points; a file with 1,900 features (a real county-subdivision shapefile)
// gets ~26 points apiece instead. This is what makes "keep every shape,
// just simplify all of them" possible without the per-shape ceiling simply
// multiplying out to an unbounded total as feature count grows - the
// previous flat-500-per-shape version would have let a 1,900-feature file
// schedule up to 950,000 total Tone.Part events (Shape/Synth.js's
// setNoteEvents, one part.add() per edge) and mount that many candidate
// Konva nodes (Shape/ComponentV2.jsx), regardless of the (separate)
// MAX_IMPORTED_GEO_SHAPES feature-count backstop above.
const TOTAL_POINT_BUDGET = 50000;
// Never reduce a shape below this - a polygon/line needs at least a few
// points to have any recognizable form at all, no matter how many total
// shapes are competing for the shared budget.
const MIN_POINTS_PER_TRACK = 8;
// Never give a single shape more than this even when it's the only dense
// one in the file - matches the single-huge-feature case's original cap
// (a lone detailed coastline/boundary, Toolbar's SIMPLIFY_REVIEW_THRESHOLD
// scenario), unchanged by how many OTHER shapes exist.
const ABSOLUTE_MAX_POINTS_PER_TRACK = 500;

// The per-shape point ceiling for an import of `trackCount` shapes - see
// TOTAL_POINT_BUDGET's own comment. Toolbar's handleGeoFileChange computes
// this once per import (after any MAX_IMPORTED_GEO_SHAPES truncation) and
// passes it to every findMinSafeRatio/simplifyTrackForImport call below,
// rather than those using a fixed constant.
export const getMaxPointsPerTrack = trackCount =>
  Math.max(
    MIN_POINTS_PER_TRACK,
    Math.min(ABSOLUTE_MAX_POINTS_PER_TRACK, Math.round(TOTAL_POINT_BUDGET / trackCount))
  );

// Below this, a track just gets silently capped (simplifyTrackForImport's
// own automatic ratio search) - not worth interrupting an import for a
// GPX hike with 600 points. Above it, Toolbar's handleGeoFileChange opens
// GeoSimplifyPreviewModal so the user can see what they'd be trading away
// before committing to it, rather than a one-size-fits-all auto-simplify.
export const SIMPLIFY_REVIEW_THRESHOLD = 5000;

// douglasPeucker's cost (and recursion depth) scales with input size - a
// raw shapefile feature can have hundreds of thousands of points, far too
// many to run DP against directly, let alone on every slider tick while
// the preview modal is open. Bounding the DP input first keeps both the
// one-time automatic path and the interactive preview fast; at this size
// the even-stride pre-sampling itself is visually lossless (nothing a
// person drags a slider over shows the difference), so no real fidelity is
// given up by this step alone - only by DP's own simplification after it.
const DP_INPUT_CAP = 5000;

const toXY = ({ lat, lon }) => [lon, lat];
const fromXY = ([lon, lat]) => ({ lat, lon });

// Ratio is epsilon expressed as a fraction of the track's own bounding-box
// diagonal - scale-independent, so the same ratio means roughly the same
// "how aggressively to simplify" regardless of how large or small a given
// track's real extent is. Used directly as GeoSimplifyPreviewModal's
// slider value.
const simplifyXYByRatio = (xyPoints, ratio) => {
  const diagonal = getBoundingBoxDiagonal(xyPoints);
  return douglasPeucker(xyPoints, Math.max(1e-9, diagonal * ratio));
};

// Finds the smallest ratio that gets `track` under maxPoints (normally
// getMaxPointsPerTrack's result for this whole import, not a fixed number)
// - GeoSimplifyPreviewModal's slider never goes below this (its left end),
// so every position on the slider is guaranteed safe; simplifyTrackForImport
// falls back to this same search when no explicit ratio is given (the
// automatic, non-interactive path for tracks under SIMPLIFY_REVIEW_THRESHOLD).
export const findMinSafeRatio = (track, maxPoints) => {
  const bounded = uniformPreSample(track.map(toXY), DP_INPUT_CAP);
  return findMinRatioForMaxVertices(bounded, maxPoints);
};

// Reduces one track to at most maxPoints points (this import's
// getMaxPointsPerTrack result), done in DP's own scale-independent ratio
// space. `ratio` is normally the user's GeoSimplifyPreviewModal slider
// choice; omitted, it's found automatically (same search findMinSafeRatio
// does). Either way the result is topped up with that same search if the
// given ratio wasn't aggressive enough on its own - maxPoints is a hard
// ceiling, not a suggestion, no matter what ratio a caller hands in.
export const simplifyTrackForImport = (track, ratio, maxPoints) => {
  if (track.length <= maxPoints) {
    return { track, wasSimplified: false };
  }

  const bounded = uniformPreSample(track.map(toXY), DP_INPUT_CAP);
  let simplified = simplifyXYByRatio(bounded, ratio != null ? ratio : 0);
  if (simplified.length > maxPoints) {
    const safeRatio = findMinRatioForMaxVertices(bounded, maxPoints);
    simplified = simplifyXYByRatio(bounded, safeRatio);
  }
  return {
    track: simplified.map(fromXY),
    wasSimplified: true,
    keptCount: simplified.length,
    originalCount: track.length,
  };
};

// zoom-0 world pixels - see utils/geoTiles.js's header comment. This is
// the fixed, zoom-independent content-space every geographic shape's
// `points` array is expressed in. Pure projection only - callers that need
// a dense track capped/simplified first should go through
// simplifyTrackForImport before this, not after.
export const toPoints = track => {
  const points = [];
  track.forEach(({ lat, lon }) => {
    const { x, y } = lonLatToWorldPixel(lon, lat, 0);
    points.push(x, y);
  });
  return points;
};

const parseGpx = text => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  // flattens every <trkseg> in a track into one continuous shape - a
  // reasonable simplification; a file with genuinely separate tracks
  // still gets one shape per <trk>
  const tracks = Array.from(doc.getElementsByTagName('trk')).map(trk =>
    Array.from(trk.getElementsByTagName('trkpt'))
      .map(pt => ({
        lat: parseFloat(pt.getAttribute('lat')),
        lon: parseFloat(pt.getAttribute('lon')),
      }))
      .filter(isValidLatLon)
  );

  // <wpt> waypoints are standalone pins, not part of any <trk> - connect
  // them into a single shape in document order (same idea as KML Points/
  // GeoJSON Point features below)
  const waypoints = Array.from(doc.getElementsByTagName('wpt'))
    .map(pt => ({
      lat: parseFloat(pt.getAttribute('lat')),
      lon: parseFloat(pt.getAttribute('lon')),
    }))
    .filter(isValidLatLon);
  if (waypoints.length) tracks.push(waypoints);

  return tracks;
};

// KML's own coordinate convention: "lon,lat[,alt] lon,lat[,alt] ..." -
// altitude (if present) is simply ignored, there's nowhere for it to go
// in a 2D shape. Shared by LineString/LinearRing/Point, which all carry
// their coordinates the same way.
const kmlCoordsToTrack = parentEl => {
  const coordsEl = parentEl.getElementsByTagName('coordinates')[0];
  if (!coordsEl) return [];
  return coordsEl.textContent
    .trim()
    .split(/\s+/)
    .map(triplet => {
      const [lon, lat] = triplet.split(',').map(Number);
      return { lat, lon };
    })
    .filter(isValidLatLon);
};

const parseKml = text => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const tracks = [];

  Array.from(doc.getElementsByTagName('LineString')).forEach(el => {
    const track = kmlCoordsToTrack(el);
    if (track.length) tracks.push(track);
  });

  // KML Polygons wrap their outer/inner boundaries in <LinearRing> - one
  // shape per ring, hole/outer distinction not needed for turning this
  // into something audible
  Array.from(doc.getElementsByTagName('LinearRing')).forEach(el => {
    const track = kmlCoordsToTrack(el);
    if (track.length) tracks.push(track);
  });

  // standalone <Point> placemarks - connect them all into one shape
  const points = [];
  Array.from(doc.getElementsByTagName('Point')).forEach(el => {
    const track = kmlCoordsToTrack(el);
    if (track.length) points.push(track[0]);
  });
  if (points.length) tracks.push(points);

  return tracks;
};

// GeoJSON's own coordinate order is [lon, lat] (longitude first) - the
// reverse of how everyone says it out loud, and an easy place to
// introduce a silent north/east swap bug if missed
const toLatLon = ([lon, lat]) => ({ lat, lon });

const parseGeoJson = text => {
  const data = JSON.parse(text);
  const tracks = [];
  const standalonePoints = [];

  const visitGeometry = geometry => {
    if (!geometry) return;
    switch (geometry.type) {
      case 'Point':
        standalonePoints.push(toLatLon(geometry.coordinates));
        break;
      case 'MultiPoint':
        tracks.push(geometry.coordinates.map(toLatLon));
        break;
      case 'LineString':
        tracks.push(geometry.coordinates.map(toLatLon));
        break;
      case 'MultiLineString':
        geometry.coordinates.forEach(coords => tracks.push(coords.map(toLatLon)));
        break;
      // one shape per ring (outer boundary + holes) - same reasoning as
      // KML's LinearRing handling above
      case 'Polygon':
        geometry.coordinates.forEach(ring => tracks.push(ring.map(toLatLon)));
        break;
      case 'MultiPolygon':
        geometry.coordinates.forEach(polygon =>
          polygon.forEach(ring => tracks.push(ring.map(toLatLon)))
        );
        break;
      case 'GeometryCollection':
        geometry.geometries.forEach(visitGeometry);
        break;
      default:
        break;
    }
  };

  if (data.type === 'FeatureCollection') {
    data.features.forEach(feature => visitGeometry(feature.geometry));
  } else if (data.type === 'Feature') {
    visitGeometry(data.geometry);
  } else {
    visitGeometry(data);
  }

  if (standalonePoints.length) tracks.push(standalonePoints);

  return tracks.map(track => track.filter(isValidLatLon));
};

// Parsing only - raw [{ lat, lon }, ...] tracks/rings, exactly as found in
// the file, no length filtering or point-reduction yet (Toolbar's
// handleGeoFileChange does both of those itself, uniformly across this and
// utils/shapefileImport.js's tracks, so GPX/KML/GeoJSON and Shapefile go
// through the identical review/simplify/log pipeline from here on).
export const parseTracksFromGeoFile = (text, extension) => {
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (ext === 'gpx') return parseGpx(text);
  if (ext === 'kml') return parseKml(text);
  if (ext === 'json' || ext === 'geojson') return parseGeoJson(text);
  throw new Error(`Unsupported track file type: .${ext}`);
};
