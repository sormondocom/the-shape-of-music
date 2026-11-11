import React, { useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Dot,
  Barline,
} from 'vexflow';
import { quantizeNoteEventsForNotation } from 'utils/notation';
import { subscribeToShapeCursor } from 'utils/playbackCursor';
import styles from './styles.module.css';

const propTypes = {
  noteEvents: PropTypes.array.isRequired, // [{ teoriaNote, duration }]
  color: PropTypes.string,
  // identifies this shape to utils/playbackCursor.js - omit to render a
  // plain static staff with no "follow along" highlighting at all
  shapeIndex: PropTypes.number,
  isPlaying: PropTypes.bool,
};

// The app's own existing selection/active-state accent (LayersPanel's
// .rowSelected/.rowButtonActive use the same color) - reused here so the
// "currently playing" note reads as the same kind of thing, rather than
// introducing a new meaning for a new color.
const HIGHLIGHT_COLOR = '#00aaff';

// Fixed 4/4 - shapes have no inherent time signature of their own (see
// utils/notation.js), and this is the one every classically-trained reader
// will expect by default for an unfamiliar piece.
const BEATS_PER_MEASURE = 4;
const BEATS_BY_VALUE = { '16': 0.25, '8': 0.5, q: 1, h: 2, w: 4 };
const beatsForNote = ({ value, dots }) => BEATS_BY_VALUE[value] * (dots ? 1.5 : 1);

// Page-like layout constants (px) - this used to be one endless horizontal
// line; real sheet music (and a printed page) wraps into measures-per-
// system rows instead, which is the whole point of this rewrite: a
// classically-trained reader expects to read top-to-bottom, not scroll
// sideways forever.
const LEFT_MARGIN = 10;
const RIGHT_MARGIN = 10;
const TOP_MARGIN = 10;
const BOTTOM_MARGIN = 10;
const MAX_SYSTEM_WIDTH = 680; // usable width per row, between margins
const SYSTEM_GAP = 30;
const CLEF_WIDTH = 30;
const TIME_SIG_WIDTH = 28;
const MEASURE_PADDING = 20;
const NOTE_WIDTH = 55;
const MIN_MEASURE_CONTENT_WIDTH = 70;

// Diatonic (letter-only, accidentals don't affect staff position) step
// number for a VexFlow key string ("c#/4" -> step 4*7+0), so pitches can be
// compared by how far they sit from the clef's own reference line without
// needing VexFlow to already have laid anything out.
const LETTER_STEPS = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
const diatonicStep = vexKey => {
  const [letter, octave] = vexKey.split('/');
  return parseInt(octave, 10) * 7 + LETTER_STEPS[letter[0]];
};
// Treble clef's middle line is B4, bass clef's is D3 - notes further from
// a clef's own middle line than the stave's 5 lines need ledger lines,
// which extend beyond the stave itself.
const CLEF_REFERENCE_STEP = {
  treble: diatonicStep('b/4'),
  bass: diatonicStep('d/3'),
};
// Comfortably more than VexFlow's actual ~5px-per-diatonic-step ledger
// spacing at default stave size, so this only ever over-estimates the
// room needed (unused whitespace), never clips a real note.
const PX_PER_STEP = 7;
const STAVE_INNER_HEIGHT = 40; // the 5 lines + clef glyph itself
const MIN_PADDING = 40;

const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Middle C sits exactly between the two clefs' comfortable registers (B4
// and D3 above, averaged), which is conventionally why it's "in the
// middle" - picking by which side of it a shape's notes mostly fall on
// gives a classically-trained reader the clef they'd actually expect for
// that register, instead of a treble clef buried in ledger lines for a
// shape that lives an octave or more below it. One clef for the whole
// shape, not a mid-piece clef change - shapes are a single melodic voice,
// and a consistent clef is far easier to read than one that switches.
const MIDDLE_C_STEP = diatonicStep('c/4');
const chooseClef = quantized => {
  const medianStep = median(quantized.map(({ vexKey }) => diatonicStep(vexKey)));
  return medianStep < MIDDLE_C_STEP ? 'bass' : 'treble';
};

// Greedily splits the quantized note stream into 4/4 measures. Shapes have
// no guarantee their rhythm divides evenly into whole measures (unlike a
// real performance quantized against a metronome), so a measure is closed
// out as soon as the *next* note would push it over - this can leave a
// measure slightly short rather than ever running over, which is the more
// forgiving failure mode for a best-effort preview.
const packIntoMeasures = quantized => {
  const measures = [];
  let current = [];
  let currentBeats = 0;
  quantized.forEach(note => {
    const beats = beatsForNote(note);
    if (current.length > 0 && currentBeats + beats > BEATS_PER_MEASURE + 0.001) {
      measures.push(current);
      current = [];
      currentBeats = 0;
    }
    current.push(note);
    currentBeats += beats;
  });
  if (current.length > 0) measures.push(current);
  return measures;
};

const measureContentWidth = measure =>
  Math.max(MIN_MEASURE_CONTENT_WIDTH, measure.length * NOTE_WIDTH);

// Packs measures into systems (rows) that fit within one page-width -
// this is the actual "move down and scroll down" fix: once a row's
// measures would exceed MAX_SYSTEM_WIDTH, the next measure starts a new
// row instead of extending the line forever.
const packIntoSystems = measures => {
  const systems = [];
  let current = [];
  let currentWidth = 0;
  measures.forEach(measure => {
    const w = measureContentWidth(measure) + MEASURE_PADDING;
    if (current.length > 0 && currentWidth + w > MAX_SYSTEM_WIDTH) {
      systems.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(measure);
    currentWidth += w;
  });
  if (current.length > 0) systems.push(current);
  return systems;
};

const buildStaveNote = (color, isHighlighted, { vexKey, accidentalCode, value, dots }) => {
  const note = new StaveNote({ keys: [vexKey], duration: value, dots, autoStem: true });
  if (accidentalCode) {
    note.addModifier(new Accidental(accidentalCode), 0);
  }
  // dots in the struct above only affects duration/tick math - the dot
  // glyph itself still needs to be explicitly attached (same two-step
  // VexFlow itself uses internally, see its own easyscore.js)
  for (let d = 0; d < dots; d++) {
    Dot.buildAndAttach([note], { all: true });
  }
  const noteColor = isHighlighted ? HIGHLIGHT_COLOR : color;
  if (noteColor) {
    note.setStyle({ fillStyle: noteColor, strokeStyle: noteColor });
  }
  return note;
};

/*
  Read-only notation preview of a single shape's melody - no editing, just
  a VexFlow render of utils/notation.js's best-effort quantization of
  whatever the shape's geometry currently produces, laid out as real 4/4
  measures wrapped into systems (rows) like a printed page, so it can
  actually be printed and handed to a classically-trained reader instead
  of scrolling sideways forever.

  While isPlaying and given a shapeIndex, also highlights whichever note is
  currently sounding (utils/playbackCursor.js, published from Shape/
  ContainerV2.jsx's isPlayingAnimator) and auto-scrolls to keep it in view
  - "follow the shape as it plays" in notation form. Each shape is its own
  instrumentation layer with its own independent follow-scroll (see
  styles.module.css's .staffScroll) - there's no coordination between
  layers playing at once, by design: each one is just independently
  viewable, not something that needs arbitrating against the others.
  Re-renders into a fresh SVG on every noteEvents/color/cursor change
  (VexFlow draws directly into the DOM node rather than React-managing it,
  so the container is cleared and rebuilt each time rather than diffed -
  simplest correct option given how rarely a single shape's note count
  makes this a real cost).
*/
function SheetStaff({ noteEvents, color, shapeIndex, isPlaying }) {
  const containerRef = useRef();
  const [cursorNoteIndex, setCursorNoteIndex] = useState(null);

  useEffect(() => {
    if (shapeIndex == null) return undefined;
    return subscribeToShapeCursor(shapeIndex, setCursorNoteIndex);
  }, [shapeIndex]);

  // Ignore whatever note last happened to be playing once playback has
  // actually stopped, rather than leaving a stale note highlighted.
  const effectiveCursorIndex = isPlaying ? cursorNoteIndex : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    // Tagged with its position in the untouched (pre-measure-split) note
    // stream before packIntoMeasures regroups it - Shape/Synth.js's
    // isPlayingAnimator publishes the currently-playing note using this
    // same position (see Synth.js's setNoteEvents/setAbsoluteNoteEvents),
    // so this is what effectiveCursorIndex is compared against below.
    const quantized = quantizeNoteEventsForNotation(noteEvents).map((note, i) => ({
      ...note,
      globalIndex: i,
    }));
    if (quantized.length === 0) return;

    const measures = packIntoMeasures(quantized);
    const systems = packIntoSystems(measures);

    const clef = chooseClef(quantized);
    const clefReferenceStep = CLEF_REFERENCE_STEP[clef];

    // Shapes routinely produce notes many octaves away from the clef's own
    // register (a shape's scale-degree index can drift arbitrarily far from
    // 0 over many edges - see utils/shape.js's getClampedMidiNoteNumber
    // comment) - size every system's row height to fit the piece's full
    // range (not just that row's own notes) so ledger lines never get
    // clipped and every system lines up at a consistent height.
    const steps = quantized.map(({ vexKey }) => diatonicStep(vexKey) - clefReferenceStep);
    const stepsAbove = Math.max(0, Math.max(...steps));
    const stepsBelow = Math.max(0, -Math.min(...steps));
    const topPadding = MIN_PADDING + stepsAbove * PX_PER_STEP;
    const bottomPadding = MIN_PADDING + stepsBelow * PX_PER_STEP;
    const systemHeight = STAVE_INNER_HEIGHT + topPadding + bottomPadding;

    // Lay out x/width per measure (first measure of each system reserves
    // extra room for its clef, and the very first measure of the piece
    // also reserves room for the time signature).
    let widestRowRight = MAX_SYSTEM_WIDTH;
    const rows = systems.map((systemMeasures, systemIndex) => {
      let x = LEFT_MARGIN;
      const row = systemMeasures.map((measure, measureIndex) => {
        const isFirstInSystem = measureIndex === 0;
        const isVeryFirst = systemIndex === 0 && isFirstInSystem;
        const extra = isFirstInSystem
          ? CLEF_WIDTH + (isVeryFirst ? TIME_SIG_WIDTH : 0)
          : 0;
        const width = measureContentWidth(measure) + extra + MEASURE_PADDING;
        const entry = { measure, x, width, isFirstInSystem, isVeryFirst };
        x += width;
        return entry;
      });
      widestRowRight = Math.max(widestRowRight, x);
      return row;
    });

    const svgWidth = LEFT_MARGIN + widestRowRight + RIGHT_MARGIN;
    const svgHeight =
      TOP_MARGIN +
      rows.length * systemHeight +
      Math.max(0, rows.length - 1) * SYSTEM_GAP +
      BOTTOM_MARGIN;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(svgWidth, svgHeight);
    const context = renderer.getContext();

    let highlightedNote = null;

    rows.forEach((row, systemIndex) => {
      const rowY = TOP_MARGIN + systemIndex * (systemHeight + SYSTEM_GAP) + topPadding;
      row.forEach(({ measure, x, width, isFirstInSystem, isVeryFirst }, measureIndex) => {
        const isVeryLast =
          systemIndex === rows.length - 1 && measureIndex === row.length - 1;

        const stave = new Stave(x, rowY, width);
        if (isFirstInSystem) stave.addClef(clef);
        if (isVeryFirst) stave.addTimeSignature(`${BEATS_PER_MEASURE}/4`);
        if (isVeryLast) stave.setEndBarType(Barline.type.END);
        stave.setContext(context).draw();

        const staveNotes = measure.map(note => {
          const isHighlighted = note.globalIndex === effectiveCursorIndex;
          const staveNote = buildStaveNote(color, isHighlighted, note);
          if (isHighlighted) highlightedNote = staveNote;
          return staveNote;
        });
        const voice = new Voice({ numBeats: BEATS_PER_MEASURE, beatValue: 4 }).setStrict(false);
        voice.addTickables(staveNotes);

        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(context, stave);
      });
    });

    // Follow-along: scroll just enough (not re-centering on every single
    // note) to keep whichever note is currently playing in view, inside
    // whatever scrollable ancestor actually has one (the Sheet Preview
    // modal's body) - scrollIntoView finds that on its own, so there's no
    // need to know the modal exists from in here at all.
    if (highlightedNote) {
      const svgEl = highlightedNote.getSVGElement();
      if (svgEl) {
        svgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [noteEvents, color, effectiveCursorIndex]);

  if (noteEvents.length === 0) {
    return <div className={styles.empty}>No notes</div>;
  }

  return <div ref={containerRef} className={styles.staffScroll} />;
}

SheetStaff.propTypes = propTypes;

export default SheetStaff;
