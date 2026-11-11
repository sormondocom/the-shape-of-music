/*
  Parses an Esri Shapefile's geometry into the same { lat, lon } track
  shape utils/geoTrackImport.js's GPX/KML/GeoJSON parsers produce, so it
  can be converted to shape points via that file's toPoints and imported
  the same way (Toolbar's handleGeoFileChange).

  A shapefile is normally distributed as a bundle of sibling files
  (.shp geometry, .shx index, .dbf attribute table, .prj projection info),
  often zipped together. Only the .shp file's GEOMETRY is read here -
  attribute data (.dbf - feature names/metadata) is intentionally not
  parsed, since turning a layer into audible shapes only needs the point
  sequences, not what each one is called. Accepts either a raw .shp file
  or a .zip containing one (the first .shp entry found is used).

  .shp binary format (reference: the public ESRI Shapefile Technical
  Description, whitepaper.pdf): a 100-byte file header, then a sequence of
  records, each an 8-byte header (big-endian record number + content
  length in 16-bit words) followed by content starting with a
  little-endian shape-type int. Every record's exact byte length is known
  up front from its own header - this parser always advances to the next
  record using that declared length, regardless of how many of a record's
  bytes it actually understood, so the Z/M (3D/measure) variants of each
  shape type "just work" without any special-casing: their X/Y coordinates
  sit at the same offsets as the plain 2D type, with extra Z/M arrays
  trailing after that get silently skipped over by that same jump.
*/

import JSZip from 'jszip';

const SHAPE_TYPE = {
  POINT: 1,
  POLYLINE: 3,
  POLYGON: 5,
  MULTIPOINT: 8,
  POINTZ: 11,
  POLYLINEZ: 13,
  POLYGONZ: 15,
  MULTIPOINTZ: 18,
  POINTM: 21,
  POLYLINEM: 23,
  POLYGONM: 25,
  MULTIPOINTM: 28,
};

const POINT_TYPES = new Set([SHAPE_TYPE.POINT, SHAPE_TYPE.POINTZ, SHAPE_TYPE.POINTM]);
const PATH_TYPES = new Set([
  SHAPE_TYPE.POLYLINE,
  SHAPE_TYPE.POLYGON,
  SHAPE_TYPE.POLYLINEZ,
  SHAPE_TYPE.POLYGONZ,
  SHAPE_TYPE.POLYLINEM,
  SHAPE_TYPE.POLYGONM,
]);
const MULTIPOINT_TYPES = new Set([
  SHAPE_TYPE.MULTIPOINT,
  SHAPE_TYPE.MULTIPOINTZ,
  SHAPE_TYPE.MULTIPOINTM,
]);

// Parses the geometry portion of a .shp file (ArrayBuffer) into one track
// per record (PolyLine/Polygon records with multiple parts/rings are
// split into one track per part - a closed ring and a disjoint path are
// both just "a sequence of points" for our purposes, so the outer-ring/
// hole distinction a Polygon normally carries doesn't need preserving).
// Standalone Point records are collected into a single shared "connect
// the dots" track, same as GPX waypoints/KML Points/GeoJSON Point
// features in geoTrackImport.js - a lone point can't form a shape alone.
export const parseShapefileBuffer = buffer => {
  const view = new DataView(buffer);
  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    throw new Error('Not a valid .shp file (unrecognized file code)');
  }

  const tracks = [];
  const standalonePoints = [];
  let offset = 100; // past the fixed 100-byte file header

  while (offset + 8 <= buffer.byteLength) {
    const contentLength = view.getInt32(offset + 4, false) * 2; // words -> bytes
    const contentStart = offset + 8;
    const recordEnd = contentStart + contentLength;
    if (contentLength < 4 || recordEnd > buffer.byteLength) break;

    const shapeType = view.getInt32(contentStart, true);

    if (POINT_TYPES.has(shapeType)) {
      const lon = view.getFloat64(contentStart + 4, true);
      const lat = view.getFloat64(contentStart + 12, true);
      standalonePoints.push({ lat, lon });
    } else if (PATH_TYPES.has(shapeType)) {
      // layout: shapeType(4) + box(32) + numParts(4) + numPoints(4) +
      // parts[numParts](4 each) + points[numPoints](16 each: x,y doubles)
      const numParts = view.getInt32(contentStart + 36, true);
      const numPoints = view.getInt32(contentStart + 40, true);
      const partsStart = contentStart + 44;
      const pointsStart = partsStart + numParts * 4;

      const partStartIndices = [];
      for (let i = 0; i < numParts; i++) {
        partStartIndices.push(view.getInt32(partsStart + i * 4, true));
      }

      for (let p = 0; p < numParts; p++) {
        const startPt = partStartIndices[p];
        const endPt = p + 1 < numParts ? partStartIndices[p + 1] : numPoints;
        const track = [];
        for (let i = startPt; i < endPt; i++) {
          const ptOffset = pointsStart + i * 16;
          if (ptOffset + 16 > recordEnd) break;
          const lon = view.getFloat64(ptOffset, true);
          const lat = view.getFloat64(ptOffset + 8, true);
          track.push({ lat, lon });
        }
        if (track.length) tracks.push(track);
      }
    } else if (MULTIPOINT_TYPES.has(shapeType)) {
      // layout: shapeType(4) + box(32) + numPoints(4) + points[numPoints](16 each)
      const numPoints = view.getInt32(contentStart + 36, true);
      const pointsStart = contentStart + 40;
      const track = [];
      for (let i = 0; i < numPoints; i++) {
        const ptOffset = pointsStart + i * 16;
        if (ptOffset + 16 > recordEnd) break;
        const lon = view.getFloat64(ptOffset, true);
        const lat = view.getFloat64(ptOffset + 8, true);
        track.push({ lat, lon });
      }
      if (track.length) tracks.push(track);
    }
    // shape type 0 (Null Shape) or anything unrecognized: nothing to
    // extract - offset still advances below using the record's own
    // declared length

    offset = recordEnd;
  }

  if (standalonePoints.length) tracks.push(standalonePoints);
  return tracks.filter(track => track.every(({ lat, lon }) => !isNaN(lat) && !isNaN(lon)));
};

// Accepts a File - either a raw .shp, or a .zip bundling a shapefile
// (.shp alongside its .shx/.dbf/.prj siblings, the usual distribution
// format). Returns the same track list parseShapefileBuffer does.
export const parseShapefile = async file => {
  const isZip = /\.zip$/i.test(file.name);
  if (!isZip) {
    const buffer = await file.arrayBuffer();
    return parseShapefileBuffer(buffer);
  }

  const zip = await JSZip.loadAsync(file);
  const shpEntry = Object.values(zip.files).find(
    entry => !entry.dir && /\.shp$/i.test(entry.name)
  );
  if (!shpEntry) {
    throw new Error('No .shp file found inside that .zip');
  }
  const buffer = await shpEntry.async('arraybuffer');
  return parseShapefileBuffer(buffer);
};
