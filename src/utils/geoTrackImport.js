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

const isValidLatLon = ({ lat, lon }) => !isNaN(lat) && !isNaN(lon);

// zoom-0 world pixels - see utils/geoTiles.js's header comment. This is
// the fixed, zoom-independent content-space every geographic shape's
// `points` array is expressed in.
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

/*
  Parses a track file's text content into one flat points array per
  track/segment/ring found (same { points } shape convertMidiTrackToPoints
  returns for a MIDI track - already positioned in real-world map
  coordinates; the caller just frames the camera on it, no rescaling).
  A track with fewer than 2 usable points can't form a shape and is
  dropped, same threshold utils/midiImport.js uses.
*/
export const convertGeoFileToShapes = (text, extension) => {
  const ext = extension.toLowerCase().replace(/^\./, '');
  let tracks;
  if (ext === 'gpx') {
    tracks = parseGpx(text);
  } else if (ext === 'kml') {
    tracks = parseKml(text);
  } else if (ext === 'json' || ext === 'geojson') {
    tracks = parseGeoJson(text);
  } else {
    throw new Error(`Unsupported track file type: .${ext}`);
  }

  return tracks.filter(track => track.length >= 2).map(track => ({ points: toPoints(track) }));
};
