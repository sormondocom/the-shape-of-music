import React, { useEffect, useMemo, useRef, useState } from 'react';
import { number, object } from 'prop-types';
import { Layer, Image as KonvaImage } from 'react-konva';
import { TILE_SIZE, getTileUrl, getVisibleTileRange } from 'utils/geoTiles';

const propTypes = {
  stageScale: number.isRequired,
  stagePos: object.isRequired,
  width: number.isRequired,
  height: number.isRequired,
};

/*
  The geographic-mode base map: a grid of OpenStreetMap raster tiles,
  rendered as plain Konva Images positioned in the same content-space
  (zoom-0 world pixels - utils/geoTiles.js) every geo-imported shape
  already lives in. Rendered as the very first (bottom-most) Layer inside
  the Stage (ShapeCanvas/Component.jsx), so it sits under the grid/shapes/
  everything else, and inherits the Stage's own scaleX/scaleY/x/y - panning
  or zooming the canvas moves and scales the tiles in exact lockstep with
  any shapes drawn on top of them, with zero extra math needed here beyond
  picking which tiles are visible.

  `listening={false}` throughout - the map is a backdrop, never a click/
  drag target.
*/
function GeoBaseLayer(props) {
  const { stageScale, stagePos, width, height } = props;

  // z/x/y -> loaded HTMLImageElement. A plain mutable Map (not state) -
  // the images themselves don't need to trigger a render on every single
  // tile load; `loadedTick` below is bumped instead, once per load, to
  // request a re-render that then reads whatever's landed in the cache so
  // far.
  const imageCacheRef = useRef(new Map());
  // only the setter is used - bumping it just forces a re-render once a
  // tile image finishes loading into imageCacheRef (a plain ref, not
  // state), so newly-arrived tiles actually get drawn
  const [, setLoadedTick] = useState(0);

  const { z, tiles } = useMemo(
    () => getVisibleTileRange({ stageScale, stagePos, width, height }),
    [stageScale, stagePos, width, height]
  );

  useEffect(() => {
    let cancelled = false;
    tiles.forEach(({ x, y }) => {
      const key = `${z}/${x}/${y}`;
      if (imageCacheRef.current.has(key)) return;
      imageCacheRef.current.set(key, null); // mark in-flight so it isn't requested twice
      const img = new window.Image();
      // Relies on tile.openstreetmap.org sending CORS headers (it does) -
      // without crossOrigin, the tiles would still DISPLAY fine but would
      // taint the canvas for any later pixel readback (ShapeCanvas/
      // Container.jsx's getScreenshot calls canvas.toDataURL(), which
      // throws on a tainted canvas). If a future tile provider doesn't
      // send CORS headers, the tile just fails silently (onerror below) -
      // not a crash, just a gap in the base map.
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        imageCacheRef.current.set(key, img);
        setLoadedTick(t => t + 1);
      };
      img.onerror = () => {
        imageCacheRef.current.delete(key);
      };
      img.src = getTileUrl(x, y, z);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [z, tiles]);

  const scaleAtZ = Math.pow(2, z);
  const tileContentSize = TILE_SIZE / scaleAtZ;

  return (
    <Layer listening={false}>
      {tiles.map(({ x, y }) => {
        const key = `${z}/${x}/${y}`;
        const img = imageCacheRef.current.get(key);
        if (!img) return null;
        return (
          <KonvaImage
            key={key}
            image={img}
            x={(x * TILE_SIZE) / scaleAtZ}
            y={(y * TILE_SIZE) / scaleAtZ}
            width={tileContentSize}
            height={tileContentSize}
            listening={false}
          />
        );
      })}
    </Layer>
  );
}

GeoBaseLayer.propTypes = propTypes;

export default GeoBaseLayer;
