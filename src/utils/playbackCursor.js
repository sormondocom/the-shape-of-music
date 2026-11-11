/*
  Lightweight pub-sub broadcasting which note is currently playing, per
  shape index - lets Sheet Preview (components/SheetStaff, mounted inside
  a react-portal modal that's completely separate from the canvas/Shape
  tree) highlight the right note in real time, without Shape/Synth.js
  needing to know anything about notation/VexFlow and without routing
  through the Project reducer (this changes far too often - every note,
  for every currently-playing shape - to belong in React state/context).

  Published from Shape/ComponentV2.jsx's isPlayingAnimator, right next to
  the existing canvas perimeter-dot animation it already drives off the
  same per-note callback - so the notation cursor automatically inherits
  that same solo/mute-aware "should this shape even animate right now"
  gating for free, rather than duplicating it here.
*/
const listenersByShapeIndex = new Map(); // shapeIndex -> Set<fn>

export const setCurrentNoteIndex = (shapeIndex, noteIndex) => {
  const listeners = listenersByShapeIndex.get(shapeIndex);
  if (!listeners) return;
  listeners.forEach(fn => fn(noteIndex));
};

export const subscribeToShapeCursor = (shapeIndex, fn) => {
  if (!listenersByShapeIndex.has(shapeIndex)) {
    listenersByShapeIndex.set(shapeIndex, new Set());
  }
  const listeners = listenersByShapeIndex.get(shapeIndex);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) listenersByShapeIndex.delete(shapeIndex);
  };
};
