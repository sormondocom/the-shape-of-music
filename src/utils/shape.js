import { dist } from './math';

const isBetween = (val, a, b) => val >= a && val <= b;

export const getAngle = (p1, p2, p3) => {
  const atanA = Math.atan2(p1.x - p2.x, p1.y - p2.y);
  const atanC = Math.atan2(p3.x - p2.x, p3.y - p2.y);
  let diff = atanA - atanC;
  diff = (diff * 180) / Math.PI;
  return diff;
};

export const thetaToScaleDegree = (theta, scaleObj) => {
  if (theta < 0) {
    theta = theta + 360;
  }

  if (theta > 180) {
    theta = theta - 360;
  }

  // right turn or left turn
  const negMult = theta < 0 ? 1 : -1;
  const absTheta = Math.abs(theta);

  // find sector
  const notesInScale = scaleObj.simple().length - 1;
  const dTheta = 180 / notesInScale;
  let lowerBound = 0;
  let upperBound = dTheta;

  let degreeDiff = 0;
  for (let i = notesInScale; i > 0; i--) {
    if (isBetween(absTheta, lowerBound, upperBound)) {
      degreeDiff = i * negMult;
      break;
    }
    lowerBound = upperBound;
    upperBound += dTheta;
  }
  return degreeDiff;
};

export const getPerimeterLength = points => {
  let len = 0;
  const n = points.length;

  for (let i = 2; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    const prevX = points[i - 2];
    const prevY = points[i - 1];
    len += dist(x, y, prevX, prevY);
  }

  // last edge
  len += dist(points[0], points[1], points[n - 2], points[n - 1]);
  return len;
};

export const getAveragePoint = points => {
  let totalX = 0;
  let totalY = 0;

  for (let i = 0; i < points.length; i += 2) {
    totalX += points[i];
    totalY += points[i + 1];
  }

  return {
    x: totalX / (points.length / 2),
    y: totalY / (points.length / 2),
  };
};

export const forEachPoint = (points, callback) => {
  for (var i = 0; i < points.length; i += 2) {
    let p = {
      x: points[i],
      y: points[i + 1],
    };
    callback(p, i);
  }
};

export const getNoteInfo = (
  points,
  scaleObj,
  i,
  iPrev,
  iPrevPrev,
  prevNoteIndex,
  // Multiplies the raw content-space edge length before it becomes a
  // note duration - 1 (the default) for ordinary musical-canvas shapes,
  // where content-space units are already in the "pixel-like" magnitude
  // this was tuned around. Geographic-mode shapes live in a totally
  // different coordinate system (real Web-Mercator world pixels - the
  // whole Earth is only 256 units wide at zoom 0) where the SAME raw
  // distance can be thousands of times smaller, which otherwise collapses
  // every note to a near-zero duration - see Shape/ContainerV2.jsx's
  // audioScale prop/ShapeCanvas/Container.jsx's appendShape/
  // importGeoShapes for where this value actually comes from.
  audioScale = 1
) => {
  const tempoModifier = 200;

  const p = {
    x: points[i],
    y: points[i + 1],
  };
  const prev = {
    x: points[iPrev],
    y: points[iPrev + 1],
  };
  const prevPrev = {
    x: points[iPrevPrev],
    y: points[iPrevPrev + 1],
  };

  const edgeLength = (dist(p.x, p.y, prev.x, prev.y) * audioScale) / tempoModifier;
  const theta = getAngle(p, prev, prevPrev);
  const degreeDiff = thetaToScaleDegree(theta, scaleObj);

  const noteIndex = prevNoteIndex + degreeDiff;

  return {
    duration: edgeLength,
    noteIndex: noteIndex,
    pIndex: i === 0 ? points.length : i,
  };
};

export const getPointsForFixedPerimeterLength = (points, length) => {
  const currLen = getPerimeterLength(points);
  const avgPoint = getAveragePoint(points);
  const ratio = length / currLen;

  const newPoints = points.slice();

  forEachPoint(points, (p, i) => {
    newPoints[i] = p.x * ratio + (1 - ratio) * avgPoint.x;
    newPoints[i + 1] = p.y * ratio + (1 - ratio) * avgPoint.y;
  });

  return newPoints;
};

/*
  A shape's scale-degree index can drift arbitrarily far from 0 over many
  edges/sharp turns (especially many-vertex traced shapes) - scaleObj.get()
  happily returns notes like "a-140" or "f#146" for those, which teoria will
  still convert to a .midi() number, but one far outside the valid 0-127
  MIDI byte range. midi-writer-js does NOT validate this - it silently
  writes the out-of-range number straight into the note-on/note-off bytes
  (e.g. -1659 or 1770), corrupting the file. Clamp to the valid range here,
  at the one place that actually needs real MIDI byte values (Tone.js's
  live playback has no such range limit, so this doesn't affect what you hear
  in the app itself - only the exported .mid file).
*/
const getClampedMidiNoteNumber = (scaleObj, noteIndex) =>
  Math.max(0, Math.min(127, scaleObj.get(noteIndex).midi()));

// Shared by convertPointsToMIDINoteEvents/convertPointsToNoteEvents below -
// both walk the exact same edges/angles to get a noteIndex per edge, they
// just differ in what they turn that noteIndex into (a clamped MIDI number
// for export, vs. the full Teoria note for notation spelling).
const walkNoteEvents = (
  points,
  scaleObj,
  firstNoteIndex,
  noteIndexModifier,
  toEvent,
  audioScale = 1
) => {
  let prevNoteIndex = firstNoteIndex;
  const noteEvents = [];

  const pushEvent = noteInfo => {
    const noteIndex = noteInfo.noteIndex + noteIndexModifier;
    noteEvents.push(toEvent(scaleObj, noteIndex, noteInfo.duration));
    prevNoteIndex = noteInfo.noteIndex;
  };

  forEachPoint(points, (p, i) => {
    if (i >= 2) {
      pushEvent(getNoteInfo(points, scaleObj, i, i - 2, i - 4, prevNoteIndex, audioScale));
    }
  });

  // last edge
  const n = points.length;
  pushEvent(getNoteInfo(points, scaleObj, 0, n - 2, n - 4, prevNoteIndex, audioScale));

  return noteEvents;
};

export const convertPointsToMIDINoteEvents = ({
  firstNoteIndex,
  points,
  scaleObj,
  noteIndexModifier,
  audioScale,
}) =>
  walkNoteEvents(
    points,
    scaleObj,
    firstNoteIndex,
    noteIndexModifier,
    (scaleObj, noteIndex, duration) => ({
      note: getClampedMidiNoteNumber(scaleObj, noteIndex),
      duration,
    }),
    audioScale
  );

// Same geometry walk as convertPointsToMIDINoteEvents, but keeps the full
// Teoria note (letter/accidental/octave) instead of collapsing it to a MIDI
// number - needed for notation, where the correct sharp/flat spelling in
// the project's actual key matters and can't be recovered from a bare MIDI
// number alone (that would require an arbitrary enharmonic guess).
export const convertPointsToNoteEvents = ({
  firstNoteIndex,
  points,
  scaleObj,
  noteIndexModifier,
  audioScale,
}) =>
  walkNoteEvents(
    points,
    scaleObj,
    firstNoteIndex,
    noteIndexModifier,
    (scaleObj, noteIndex, duration) => ({
      teoriaNote: scaleObj.get(noteIndex),
      duration,
    }),
    audioScale
  );

export const getPanningValText = pan =>
  pan > 0 ? `${pan} R` : `${Math.abs(pan)} L`;

// A shape's vertical position (in canvas CONTENT space - see Shape/
// ContainerV2.jsx's handleDrag) maps to one of these 12 integer scale-
// degree transpositions, spread across this fixed content-space span.
// Deliberately NOT window.innerHeight (a screen-space quantity) - that was
// the old basis, and it meant zooming/panning the canvas silently changed
// what note a shape would get even though the shape itself never moved in
// the actual composition. This span is just a fixed reference distance in
// content pixels, picked to feel similar in practice to the old
// screen-height-based range at 100% zoom with no pan - it has no
// relationship to any particular window size any more.
export const PITCH_MODIFIER_MIN = -7;
export const PITCH_MODIFIER_MAX = 5;
export const PITCH_MODIFIER_SPAN_PX = 900;

// The content-space Y a shape's average point needs to sit at for
// handleDrag's own mapping above to come out to exactly 0 - i.e. "no
// transposition". Used by utils/midiImport.js's import placement: an
// imported MIDI shape already carries its own exact pitches (see Shape/
// Synth.js's val.midi !== undefined path), so wherever it happens to land
// vertically on import shouldn't silently add an unrelated semitone shift
// on top of them. Solving PITCH_MODIFIER_MAX + y/PITCH_MODIFIER_SPAN_PX *
// (PITCH_MODIFIER_MIN - PITCH_MODIFIER_MAX) = 0 for y.
export const ZERO_TRANSPOSITION_CONTENT_Y =
  (PITCH_MODIFIER_MAX * PITCH_MODIFIER_SPAN_PX) /
  (PITCH_MODIFIER_MAX - PITCH_MODIFIER_MIN);

export const PRESET_SHAPES = {
  TRIANGLE: { sides: 3, label: 'Triangle' },
  SQUARE: { sides: 4, label: 'Square' },
  PENTAGON: { sides: 5, label: 'Pentagon' },
  HEXAGON: { sides: 6, label: 'Hexagon' },
  CIRCLE: { sides: 32, label: 'Circle' }, // approximated as a many-sided polygon
};

export const generateRegularPolygonPoints = ({
  sides,
  centerX,
  centerY,
  radius,
}) => {
  const points = [];
  const angleOffset = -Math.PI / 2; // first vertex points straight up
  for (let i = 0; i < sides; i++) {
    const angle = angleOffset + (i * 2 * Math.PI) / sides;
    points.push(centerX + radius * Math.cos(angle));
    points.push(centerY + radius * Math.sin(angle));
  }
  return points;
};
