/*
  Two small pub-sub channels backing the PlayBar - deliberately outside
  React state/context, same reasoning as utils/playbackCursor.js: these
  change far too often (every shape, every time its loop length changes;
  every scrub/seek while paused) to route through the Project reducer
  without re-rendering the whole tree.

  1) Shape loop durations - each shape (Shape/useShapeSynth.js) registers
     how long its own loop takes (startOffset + one loop period, real
     seconds) whenever that changes. PlayBar has no fixed "song length" to
     show progress against (every shape loops independently, deliberately
     at whatever length its own content gives it - see
     utils/midiImport.js's commonLoopDuration comment for the one case
     where several shapes DO share a length), so it just uses the longest
     one currently registered as its own total track length.

  2) Transport time preview - broadcasts a point on the global Transport
     timeline so every shape can show "what note would be playing right
     now" without actually triggering sound. Only meaningful while
     paused/scrubbing - during real playback each shape's own Tone.Part
     already drives its progress dot note-by-note, and this would just
     fight that for no benefit.
*/

const durationsByShapeIndex = new Map();
const durationListeners = new Set();

export const setShapeDuration = (shapeIndex, seconds) => {
  if (seconds > 0) {
    durationsByShapeIndex.set(shapeIndex, seconds);
  } else {
    durationsByShapeIndex.delete(shapeIndex);
  }
  durationListeners.forEach(fn => fn());
};

export const removeShapeDuration = shapeIndex => {
  if (!durationsByShapeIndex.has(shapeIndex)) return;
  durationsByShapeIndex.delete(shapeIndex);
  durationListeners.forEach(fn => fn());
};

export const getMaxShapeDuration = () => {
  let max = 0;
  durationsByShapeIndex.forEach(value => {
    if (value > max) max = value;
  });
  return max;
};

export const subscribeToShapeDurations = fn => {
  durationListeners.add(fn);
  return () => durationListeners.delete(fn);
};

const timeListeners = new Set();

export const publishTransportTime = seconds => {
  timeListeners.forEach(fn => fn(seconds));
};

export const subscribeToTransportTime = fn => {
  timeListeners.add(fn);
  return () => timeListeners.delete(fn);
};
