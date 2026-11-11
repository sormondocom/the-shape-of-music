/*
  Turns a shape's note events (utils/shape.js's convertPointsToNoteEvents -
  the same geometry walk the MIDI export uses, keeping the full Teoria note
  instead of a bare MIDI number) into VexFlow-ready events, for the Sheet
  Preview feature (components/SheetStaff). Read-only/preview only - there's
  no notation editor, just a best-effort visualization of what a shape
  already sounds like.
*/

// VexFlow key string ("c#/4") from a Teoria Note object
export const toVexKey = teoriaNote =>
  `${teoriaNote.name()}${teoriaNote.accidental()}/${teoriaNote.octave()}`;

// VexFlow's Accidental only takes a glyph code for an accidental that's
// actually present - there's no "natural" case to handle here since this
// app never prints a key signature (see quantizeNoteEventsForNotation's
// comment above NOTATABLE_DURATIONS) for it to cancel.
const ACCIDENTAL_CODES = { '#': '#', '##': '##', b: 'b', bb: 'bb' };

// Standard notatable duration ratios, as a multiple of one quarter note,
// including dotted variants. Deliberately simple/duple only (no triplets) -
// shapes have no inherent musical grid (edge length is a free real number),
// so this is always an approximation, not a transcription.
const NOTATABLE_DURATIONS = [
  { ratio: 0.25, value: '16', dots: 0 },
  { ratio: 0.375, value: '16', dots: 1 },
  { ratio: 0.5, value: '8', dots: 0 },
  { ratio: 0.75, value: '8', dots: 1 },
  { ratio: 1, value: 'q', dots: 0 },
  { ratio: 1.5, value: 'q', dots: 1 },
  { ratio: 2, value: 'h', dots: 0 },
  { ratio: 3, value: 'h', dots: 1 },
  { ratio: 4, value: 'w', dots: 0 },
];

const nearestNotatableDuration = ratio => {
  const clamped = Math.max(
    NOTATABLE_DURATIONS[0].ratio,
    Math.min(NOTATABLE_DURATIONS[NOTATABLE_DURATIONS.length - 1].ratio, ratio)
  );
  return NOTATABLE_DURATIONS.reduce((best, entry) =>
    Math.abs(entry.ratio - clamped) < Math.abs(best.ratio - clamped) ? entry : best
  );
};

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/*
  Picks the median edge duration as this shape's implied "beat" (a quarter
  note), then snaps every edge's duration, as a ratio to that beat, to the
  nearest standard notatable length above. The median (rather than, say, the
  shortest edge) is deliberate - it keeps a single long outlier edge (or a
  single short one) from skewing what "one beat" means for the whole shape.
*/
export const quantizeNoteEventsForNotation = noteEvents => {
  if (noteEvents.length === 0) return [];
  const beatSeconds = median(noteEvents.map(e => e.duration)) || 1;

  return noteEvents.map(({ teoriaNote, duration }) => {
    const { value, dots } = nearestNotatableDuration(duration / beatSeconds);
    return {
      vexKey: toVexKey(teoriaNote),
      accidentalCode: ACCIDENTAL_CODES[teoriaNote.accidental()] || null,
      value,
      dots,
    };
  });
};
