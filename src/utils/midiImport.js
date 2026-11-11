/*
  Turns a sequence of real MIDI notes back into shape points - but sound and
  picture are two separate outputs now:

  - `points`: the geometric shape, built by snapping each pitch-to-pitch
    interval to the current project scale (the inverse of
    convertPointsToMIDINoteEvents/getNoteInfo/thetaToScaleDegree in
    utils/shape.js) - this is still a *picture* of the file, lossy by
    construction (only notesInScale buckets per direction), and intentionally
    unchanged from the original implementation.
  - `noteEvents`: the exact original { midi, duration } per note, untouched
    by any scale snapping. Shape/Synth.js plays these directly when present,
    bypassing the geometry entirely, so audio is an exact reproduction of the
    source file regardless of how coarse the picture's angle-bucketing is.

  Verified against the real forward functions (thetaToScaleDegree) with a
  Node script before being wired into the UI: every possible scale-degree
  delta round-trips through scaleDegreeToTheta -> thetaToScaleDegree back to
  the same delta.

  Each track's own GM instrument (track.instrument.number, from @tonejs/midi)
  is handled separately - see assignMidiImportChannels below - now that SF2
  support means there's an actual sound for every one of the 128 GM
  programs, not just the ~8 built-in types.

  Timing uses note.duration/note.time (@tonejs/midi's own real-seconds
  values, already correct for the file's actual tempo map and PPQ) rather
  than hand-converting note.durationTicks - an earlier version did its own
  tick math using a hardcoded 128-ticks-per-quarter-note assumption and the
  *project's* tempo slider value, which ignored the file's real tempo and
  its real PPQ (often 480 or 960, not 128) entirely. That didn't just bias
  imports slow - it produced an effectively arbitrary tempo depending on
  which DAW/PPQ the file happened to be authored with (verified: a 140 BPM,
  480-PPQ test file imported as an effective 15 BPM). Using the already-
  correct note.duration means an import now plays at roughly the source
  file's own original tempo when the project's tempo slider is at its
  default/reference value (50) - see utils/shape.js's getNoteInfo, whose
  edgeLength/200 convention this matches: raw duration is real seconds at
  slider=50, independently scaled by playbackRate=tempo/50 from there.

  Two more timing facts a source file carries that earlier versions threw
  away entirely - both exposed now because a listener can hear the gap
  where they used to be silently collapsed:

  - Different tracks legitimately start at different times (an intro with
    just piano, strings entering 8 bars later, etc). `startTime` (this
    track's first note's own note.time) is returned so the caller
    (ShapeCanvas/Container.jsx's importMidiShapes) can turn each track's
    *absolute* entrance into a *relative* one (offset from the earliest
    track in the same import) and hand it to the shape as its startOffset -
    see Shape/Synth.js's setStartOffset. Previously every imported shape's
    Tone.Part started at Transport time 0 regardless, so simultaneous
    tracks that were never meant to enter together all did anyway.

  - A single track's own notes aren't always back-to-back - there can be a
    rest between one note ending and the next starting. noteEvents.duration
    used to mean "how long this note rings" AND, via Synth.js's
    `delay += ev.duration` scheduling, "how long until the next note" -
    conflating the two collapses every rest to zero (the next note always
    fired the instant the previous one's sound ended). `duration` here now
    means the real scheduling gap (onset to onset, note.time deltas) and a
    separate `ringDuration` (<= duration) is the audible length - the
    difference between them is silence Synth.js now actually leaves in
    place, and Shape/ComponentV2.jsx renders as a dashed stretch of the
    edge so a rest is visible, not just audible. The *geometry* (edge
    length) is driven by the same gap, not the audible length, so a rest
    still occupies real space on the shape - a long edge with a short
    ringing lead-in and a dashed tail, rather than auto-compressing to the
    sound's own length the way it did before.
*/

// From utils/sf2Reference, not utils/sf2Engine - this file has to stay
// importable from a plain Node context (scripts/exportLineArt.js), and
// sf2Engine.js pulls in the actual browser-only audio engine (Tone.js,
// an AudioWorklet). sf2Reference.js is the same three functions with
// none of that.
import { isSf2Reference, parseSf2Program, makeSf2Reference } from 'utils/sf2Reference';

const TEMPO_MODIFIER = 200; // matches utils/shape.js's getNoteInfo

/* Collapses simultaneous notes (chords) sharing one onset tick into a single
   representative note (the highest pitch of the group) so a chord reads as
   one vertex, matching how many "notes" a listener actually perceives -
   without this, every chord tone becomes its own vertex and inflates the
   shape's point count several-fold beyond the real note count. */
export const groupNotesByOnset = notes => {
  const byTicks = new Map();
  notes.forEach(note => {
    const prev = byTicks.get(note.ticks);
    if (!prev || note.midi > prev.midi) {
      byTicks.set(note.ticks, note);
    }
  });
  return Array.from(byTicks.values()).sort((a, b) => a.ticks - b.ticks);
};

/* Inverse of thetaToScaleDegree: given a scale-degree delta, returns a
   representative turn angle (the midpoint of whichever bucket produced that
   delta) that reproduces the same delta if fed back through
   thetaToScaleDegree. A jump bigger than one octave's worth of scale steps
   is clamped - same "lossy but plausible" approach as the bucketing itself. */
export const scaleDegreeToTheta = (degreeDiff, scaleObj) => {
  if (degreeDiff === 0) return 0;
  const notesInScale = scaleObj.simple().length - 1;
  const clamped = Math.max(-notesInScale, Math.min(notesInScale, degreeDiff));
  const magnitude = Math.abs(clamped);
  const dTheta = 180 / notesInScale;
  const lowerBound = (notesInScale - magnitude) * dTheta;
  const midpointAbsTheta = lowerBound + dTheta / 2;
  const sign = clamped > 0 ? -1 : 1;
  return sign * midpointAbsTheta;
};

/* Finds the scale-degree index k (scaleObj.get(k)) whose MIDI pitch is
   closest to targetMidi, searching outward from searchCenter (the previous
   note's own degree index, so consecutive notes stay close together rather
   than jumping to a same-pitch-class match in a distant octave). */
export const findNearestScaleDegreeIndex = (scaleObj, targetMidi, searchCenter = 0) => {
  const notesInScale = scaleObj.simple().length - 1;
  const refMidi = scaleObj.get(searchCenter).midi();
  // ~12 semitones per notesInScale scale steps (one octave)
  const estimate =
    searchCenter + Math.round(((targetMidi - refMidi) / 12) * notesInScale);

  let best = estimate;
  let bestDiff = Infinity;
  const window = notesInScale + 2;
  for (let k = estimate - window; k <= estimate + window; k++) {
    const diff = Math.abs(scaleObj.get(k).midi() - targetMidi);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
};

/*
  Walks a MIDI track's notes (in @tonejs/midi's { midi, duration, ... }
  shape) into a flat [x0,y0,x1,y1,...] point list - one vertex per onset
  (chords collapsed via groupNotesByOnset), starting at the origin. Every
  onset becomes a vertex, however many there are - an earlier version
  capped this at 300 and dropped the rest, on the reasoning that a very
  dense track has "more note-on events than a listener would call the
  notes." That cap silently truncated the audio too (noteEvents, not just
  the picture), and did so per-track independently, with no guarantee two
  tracks from the same file got truncated to the same real-seconds point -
  exactly the kind of per-track mismatch that desyncs loops over time (see
  Toolbar's commonLoopDuration). Zoom handles arbitrarily dense shapes fine
  on the canvas side, so there's no practical reason left to drop notes
  here. The resulting shape is intentionally unscaled/uncentered (the
  caller positions it on the actual canvas); returns null for tracks too
  short to form a shape (fewer than 3 onsets). Returns { points,
  noteEvents } - noteEvents is the exact { midi, duration } per note (see
  file header), independent of the geometry and not affected by the
  canvas-fit rescale Container.jsx applies to points afterward, so
  absolute-mode audio timing is never distorted by however big the shape
  happens to be drawn.
*/
// floor on the onset-to-onset gap used for scheduling/geometry - guards
// against a zero or near-zero edge if two source notes somehow carry the
// same onset time without having been collapsed by groupNotesByOnset
// (which dedupes by tick, not by the float-seconds .time derived from it)
const MIN_GAP_SECONDS = 0.01;

export const convertMidiTrackToPoints = ({ notes, scaleObj }) => {
  if (!notes || notes.length < 3) return null;

  const usedNotes = groupNotesByOnset(notes);
  if (usedNotes.length < 3) return null;

  const noteEvents = usedNotes.map((note, i) => {
    const isLast = i === usedNotes.length - 1;
    // the real scheduling/geometry unit: time until the NEXT note's onset,
    // not how long this one rings - a staccato note followed by a rest
    // has a short ring but the same gap it always would. The last note in
    // a loop has no "next" onset to measure to, so (same as every other
    // shape in this app) it just rings for its own length before the loop
    // repeats - there's no way to know how long a MIDI file's own silence
    // "should" be once it's being looped rather than played once through.
    const gap = isLast
      ? note.duration
      : Math.max(usedNotes[i + 1].time - note.time, MIN_GAP_SECONDS);
    // how long the note actually sounds - never more than the gap (a note
    // whose source duration overlapped into the next one's onset, i.e.
    // overlapping/legato notes this app's model can't represent, is
    // clamped rather than left to bleed into the next note's attack)
    const ringDuration = Math.min(note.duration, gap);
    // note.velocity is @tonejs/midi's normalized 0-1 - carried straight
    // through to Shape/Synth.js, which converts it for whichever playback
    // path (SF2 MIDI velocity 0-127, or Tone.js's own 0-1) applies.
    // Previously dropped entirely (every imported note played at a flat,
    // fixed velocity) - real dynamics from the source file are only
    // actually audible now that SF2 instruments are velocity-sensitive
    // (genuine sample layers, not just a volume scalar).
    return { midi: note.midi, duration: gap, ringDuration, velocity: note.velocity };
  });

  let degreeIndex = findNearestScaleDegreeIndex(scaleObj, usedNotes[0].midi, 0);
  let heading = 0;
  let x = 0;
  let y = 0;
  const points = [x, y];

  for (let i = 1; i < usedNotes.length; i++) {
    const nextDegreeIndex = findNearestScaleDegreeIndex(
      scaleObj,
      usedNotes[i].midi,
      degreeIndex
    );
    const degreeDiff = nextDegreeIndex - degreeIndex;
    const theta = scaleDegreeToTheta(degreeDiff, scaleObj);
    heading += theta;

    // edge length is driven by the same gap noteEvents uses for scheduling
    // (not the audible ring length) - a rest still occupies real space on
    // the shape, the same way utils/shape.js's getNoteInfo maps a hand-
    // drawn edge's pixel length to duration (edgeLength = pixels / TEMPO_MODIFIER)
    const dist = noteEvents[i].duration * TEMPO_MODIFIER;

    const rad = (heading * Math.PI) / 180;
    x += dist * Math.sin(rad);
    y += dist * Math.cos(rad);
    points.push(x, y);

    degreeIndex = nextDegreeIndex;
  }

  const lastNote = usedNotes[usedNotes.length - 1];
  return {
    points,
    noteEvents,
    startTime: usedNotes[0].time,
    // this track's own natural span, start to last-note-off - used by the
    // caller (Toolbar's handleMidiFileChange) to give every track from the
    // same import a shared loop length. Without that, each track loops at
    // whatever its own note content happens to add up to - fine when
    // that's coincidentally close to every other track's own total, but
    // real tracks from the same file routinely aren't (a bassline doesn't
    // generally add up to the exact same real-seconds span as the melody
    // it accompanies). Independently-looping tracks with even a small
    // mismatch in period drift apart a little more every cycle -
    // inaudible for the first loop or two, unmistakable a dozen cycles in,
    // which is exactly "falls behind until completely out of sync" rather
    // than a fixed, constant lag.
    endTime: lastNote.time + lastNote.duration,
  };
};

/*
  Decides which colorIndex (= MIDI channel) each imported track's GM
  program should play through, given the channels already active/assigned
  before the import. Reuses an already-active channel if it's already
  playing the exact same SF2 program (so e.g. two "Grand Piano" tracks in
  one file don't claim two separate channels for no reason); otherwise
  claims the next free channel slot, up to the 16-channel ceiling that
  utils/project.js's activeColorIndices already enforces for manually-added
  channels.

  If a file has more distinct programs than there are free channels left,
  the overflow tracks fall back to the first channel this same import
  assigned (not a silently-random existing channel) - still not correct,
  but a predictable, visible fallback rather than one that depends on
  whatever happened to be active before the import.

  Returns:
  - assignments: [{ colorIndex, instrumentName }] - only the NEWLY claimed
    channels, ready to dispatch via PROJECT_ACTIONS.ASSIGN_INSTRUMENT_CHANNELS
  - colorIndexForTrack: one colorIndex per entry in `programs`, same order
*/
export const assignMidiImportChannels = ({
  programs,
  activeColorIndices,
  selectedSynths,
}) => {
  const MAX_CHANNELS = 16;
  const assignments = [];
  const colorIndexForTrack = [];
  const usedColorIndices = new Set(activeColorIndices);

  const programToColorIndex = new Map();
  activeColorIndices.forEach(colorIndex => {
    const synth = selectedSynths[colorIndex];
    if (isSf2Reference(synth)) {
      programToColorIndex.set(parseSf2Program(synth), colorIndex);
    }
  });

  let fallbackColorIndex = null;

  programs.forEach(program => {
    if (programToColorIndex.has(program)) {
      colorIndexForTrack.push(programToColorIndex.get(program));
      return;
    }

    let freeColorIndex = -1;
    for (let i = 0; i < MAX_CHANNELS; i++) {
      if (!usedColorIndices.has(i)) {
        freeColorIndex = i;
        break;
      }
    }

    if (freeColorIndex === -1) {
      if (fallbackColorIndex === null) {
        fallbackColorIndex =
          colorIndexForTrack.length > 0
            ? colorIndexForTrack[0]
            : activeColorIndices.length > 0
            ? activeColorIndices[0]
            : 0;
      }
      colorIndexForTrack.push(fallbackColorIndex);
      return;
    }

    usedColorIndices.add(freeColorIndex);
    programToColorIndex.set(program, freeColorIndex);
    assignments.push({ colorIndex: freeColorIndex, instrumentName: makeSf2Reference(program) });
    colorIndexForTrack.push(freeColorIndex);
  });

  return { assignments, colorIndexForTrack };
};
