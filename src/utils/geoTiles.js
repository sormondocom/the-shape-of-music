/*
  Standard "slippy map" tile math (the same scheme OpenStreetMap, Google
  Maps, Leaflet, Mapbox etc all use): the whole world is projected into a
  TILE_SIZE x TILE_SIZE square at zoom 0, doubling in pixel size each zoom
  level up (zoom z -> TILE_SIZE * 2^z pixels square), and sliced into
  TILE_SIZE x TILE_SIZE raster tiles addressed by (z, x, y).

  Everything geographic in this app - the OSM base layer (GeoBaseLayer) AND
  every imported GPS shape (geoTrackImport.js, shapefileImport.js) - shares
  ONE fixed coordinate space: world pixels AT ZOOM 0 (a 256x256 square
  covering the whole globe, Mercator-cut at ~85.05 degrees latitude same as
  every other web map). That's what shape `points` arrays are expressed in
  for geographic-mode content. Konva's own stageScale then does the actual
  zoom multiplication on top (stageScale = 2^geoZoom, see ShapeCanvas/
  Container.jsx) - so a tile's on-screen size and a shape's on-screen size
  grow/shrink in exact lockstep, the same way any slippy map keeps its
  pins/routes glued to the base map while zooming.
*/

export const TILE_SIZE = 256;
export const MIN_GEO_ZOOM = 1;
export const MAX_GEO_ZOOM = 18;
export const DEFAULT_GEO_ZOOM = 3;

const clampZoom = zoom => Math.max(MIN_GEO_ZOOM, Math.min(MAX_GEO_ZOOM, zoom));

// lon/lat (degrees) -> world pixel coordinates at the given zoom. This is
// the standard Web Mercator slippy-map formula (EPSG:3857 rescaled to
// pixels) - NOT the same projection utils/geoTrackImport.js used to use
// (plain Mercator-in-degrees) - this one is what tile servers actually
// address tiles by, which is the whole point: a shape positioned with this
// function lines up with the real tile underneath it.
export const lonLatToWorldPixel = (lon, lat, zoom) => {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * worldSize;
  const latRad = (lat * Math.PI) / 180;
  const y =
    (0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI)) * worldSize;
  return { x, y };
};

// Inverse of the above - world pixel coordinates at a given zoom back to
// lon/lat. Used to frame the camera on an imported track's bounds (convert
// back to lat/lon isn't actually required for that - bounds stay in world-
// pixel space throughout - but kept here since any future "show me where
// this is" UI will want it).
export const worldPixelToLonLat = (x, y, zoom) => {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const lon = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
};

// tile.openstreetmap.org - the OSM Foundation's own standard tile server.
// Usage policy (https://operations.osmfoundation.org/policies/tiles/) asks
// for: reasonable (non-bulk) request volume, and visible attribution -
// see GeoBaseLayer's attribution overlay, which is NOT optional to remove.
// For any heavier/production use, swap this for a dedicated tile provider
// (MapTiler, Stadia, Mapbox, a self-hosted tile server, etc).
export const getTileUrl = (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

// Given the current committed stageScale/stagePos (content-space = world
// pixels at zoom 0, per the header comment) and viewport size, figures out
// which integer tile zoom to actually fetch tiles at (nearest to the
// current continuous zoom) and which tile (x,y) indices at that zoom cover
// the visible viewport, with a 1-tile margin so tiles don't visibly pop in
// right at the edge.
export const getVisibleTileRange = ({ stageScale, stagePos, width, height }) => {
  const geoZoom = Math.log2(stageScale);
  const z = clampZoom(Math.round(geoZoom));
  const scaleAtZ = Math.pow(2, z);

  // viewport's visible content-space (zoom-0) rect, converted to zoom-z
  // pixel units (multiply by scaleAtZ) to address tiles with
  const minX = ((-stagePos.x) / stageScale) * scaleAtZ - TILE_SIZE;
  const maxX = ((width - stagePos.x) / stageScale) * scaleAtZ + TILE_SIZE;
  const minY = ((-stagePos.y) / stageScale) * scaleAtZ - TILE_SIZE;
  const maxY = ((height - stagePos.y) / stageScale) * scaleAtZ + TILE_SIZE;

  const maxTileIndex = Math.pow(2, z) - 1;
  const tileMinX = Math.max(0, Math.floor(minX / TILE_SIZE));
  const tileMaxX = Math.min(maxTileIndex, Math.floor(maxX / TILE_SIZE));
  const tileMinY = Math.max(0, Math.floor(minY / TILE_SIZE));
  const tileMaxY = Math.min(maxTileIndex, Math.floor(maxY / TILE_SIZE));

  const tiles = [];
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      tiles.push({ x: tx, y: ty });
    }
  }
  return { z, tiles };
};

// Scrollbar math for geographic mode (ShapeCanvas/PanScrollbar, via
// Container.jsx) - utils/panScrollbar.js's version defines "world" as a
// multiple of the on-screen canvas size, which assumes content-space units
// are roughly screen-pixel-sized (true in musical mode, way off in
// geographic mode, where content-space is zoom-0 world pixels - the WHOLE
// globe is only TILE_SIZE units wide). The world here is just the fixed
// zoom-0 tile square itself: 0..TILE_SIZE on both axes.
export const getGeoScrollbarMetrics = ({ stagePosAxis, stageScale, canvasSize }) => {
  const worldSize = TILE_SIZE;
  const viewportContentSize = canvasSize / stageScale;
  const thumbFraction = Math.max(0.02, Math.min(1, viewportContentSize / worldSize));
  const viewportStart = -stagePosAxis / stageScale;
  const range = worldSize - viewportContentSize;
  const positionFraction =
    range > 0 ? Math.max(0, Math.min(1, viewportStart / range)) : 0;
  return { thumbFraction, positionFraction };
};

export const getGeoStagePosFromFraction = ({ fraction, stageScale, canvasSize }) => {
  const worldSize = TILE_SIZE;
  const viewportContentSize = canvasSize / stageScale;
  const range = Math.max(0, worldSize - viewportContentSize);
  const viewportStart = Math.max(0, Math.min(1, fraction)) * range;
  return -viewportStart * stageScale;
};

// Centers/zooms the geo camera (stageScale/stagePos) so a content-space
// (zoom-0 world-pixel) bounding box fills most of the viewport, with
// padding - the "fly to" that runs right after a GPS track import so the
// user actually sees what just got imported, rather than it landing
// somewhere off in the current view. Falls back to DEFAULT_GEO_ZOOM when
// the box is degenerate (e.g. a single point, zero width/height).
export const frameGeoBounds = (bounds, width, height) => {
  const { minX, minY, maxX, maxY } = bounds;
  const boxWidth = Math.max(1e-6, maxX - minX);
  const boxHeight = Math.max(1e-6, maxY - minY);
  const padding = 0.85; // leave ~15% margin around the framed content
  const zoomForWidth = Math.log2((width * padding) / boxWidth);
  const zoomForHeight = Math.log2((height * padding) / boxHeight);
  const zoom = clampZoom(Math.min(zoomForWidth, zoomForHeight));
  const stageScale = Math.pow(2, zoom);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    stageScale,
    stagePos: {
      x: width / 2 - centerX * stageScale,
      y: height / 2 - centerY * stageScale,
    },
  };
};

export const getDefaultGeoView = (width, height, lon = 10, lat = 25) => {
  const center0 = lonLatToWorldPixel(lon, lat, 0);
  const stageScale = Math.pow(2, DEFAULT_GEO_ZOOM);
  return {
    stageScale,
    stagePos: {
      x: width / 2 - center0.x * stageScale,
      y: height / 2 - center0.y * stageScale,
    },
  };
};
