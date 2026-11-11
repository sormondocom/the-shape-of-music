# How a shape's pitch is determined

This is the precise mechanics behind "what note does this shape make" -
written up because the logic is spread across a few files and has a couple
of non-obvious rules (especially the transposition and imported-MIDI paths)
that are easy to misremember or accidentally break.

For the short, user-facing version, see the README's
[Overview](../README.md#overview). This document is the implementation-level
version, with exact source references.

## The big picture

A shape's melody is built from two independent ingredients, combined per
note:

```
 final pitch  =  scaleObj.get( edgeNoteIndex + transposition )
                              \_____________/   \____________/
                               geometry of        shape's
                               the shape's         vertical
                               turns (per edge)     position
```

- **`scaleObj`** - the project's current key + scale/mode (one shared value
  for the whole project, set by the Toolbar's Key/Scale dropdowns).
- **`edgeNoteIndex`** - a running scale-degree count, built edge by edge
  from how sharply the shape turns at each vertex.
- **`transposition`** (`noteIndexModifier` in code) - an integer shift
  derived from the shape's vertical position in the canvas, applied to
  every note the shape plays.

Everything below expands each of these.

## 1. The project's scale

```js
// utils/project.js
scaleObj = Teoria.note(tonic).scale(scale)   // e.g. Teoria.note('a').scale('major')
```

One `scaleObj` for the entire project - every shape, regardless of color or
instrument, reads notes off the same key/scale. Changing the Key or Scale
dropdown in the Toolbar (`SET_TONIC` / `SET_MODE` in
`components/Project/index.jsx`) rebuilds this and immediately changes what
every shape sounds like, without touching any shape's own geometry.

`scaleObj.get(n)` returns the `n`-th note of that scale, where `n` can be
*any* integer - not just 0 to 6. Negative or large `n` just keeps counting
through lower/higher octaves (e.g. for C major: `get(0)` = B2, `get(1)` = C3
the tonic, `get(8)` = C4, `get(-2)` = G2, and so on indefinitely in both
directions). This is what makes the two formulas below work as simple
addition - there's no wraparound or modulo anywhere.

## 2. The starting note

```js
// Shape/ContainerV2.jsx - initial state
firstNoteIndex: 1
```

Every shape is seeded with `firstNoteIndex = 1`, which - per Teoria's own
indexing above - is the scale's tonic. So a freshly drawn shape's first
note is always the tonic, *before* transposition is applied (see §4). This
value is never changed anywhere after a shape is created; it's a fixed
starting point, not something the user adjusts directly.

## 3. Turning geometry into melody (edge by edge)

This is `utils/shape.js`'s `getNoteInfo`, called once per edge as the shape
is walked (`forEachPoint`, wrapping around to close the polygon). For each
vertex `p`, looking at the *previous* two vertices (`prev`, `prevPrev`):

```js
const theta = getAngle(p, prev, prevPrev);       // turn angle at `prev`, in degrees
const degreeDiff = thetaToScaleDegree(theta, scaleObj);
const noteIndex = prevNoteIndex + degreeDiff;     // running total, edge by edge
```

### 3a. The turn angle

`getAngle` measures the angle *at* the middle point between the ray back
toward the vertex before it and the ray forward to the current vertex. A
shape whose edge keeps going in roughly the same direction (barely turning)
produces an angle close to **180°**. A shape that sharply reverses
direction (a near U-turn) produces an angle close to **0°**.

### 3b. Angle -> scale-degree jump size

`thetaToScaleDegree` divides that 0°-180° range into as many equal sectors
as the scale has *steps* (its note count minus one - 6 sectors of 30° each
for a 7-note diatonic scale, fewer/wider sectors for a pentatonic scale,
etc.), and picks the jump size accordingly:

| Turn angle (magnitude) | Meaning | Scale-degree jump |
|---|---|---|
| near 180° (barely turning) | shallow turn | 1 (a small step) |
| ...sectors in between... | | 2, 3, 4, 5... |
| near 0° (near U-turn) | sharp turn | N (the scale's step count - a big leap) |

**Sharp turns = big melodic leaps. Shallow turns = small melodic steps.**
This is the literal shape-to-melody translation the whole app is built
around.

The *sign* of the jump (ascending vs. descending) comes from which way the
shape turns: a right turn produces a positive (ascending) jump, a left
turn a negative (descending) one - matching the README's "a sharp right
turn means the next note is much higher... a shallow left turn means the
next note is a little lower."

### 3c. Accumulating

Each edge's `degreeDiff` is *added* to a running `noteIndex` that carries
over from the previous edge (starting from `firstNoteIndex`, §2) - the
melody is a cumulative walk through scale degrees, not a fixed lookup per
vertex position. This is why dragging a single vertex can shift every note
*after* it in the loop, not just that one note.

### 3d. Note duration

Also computed per edge, independently of pitch: `edgeLength / 200` (the
edge's pixel length in content space, divided by a fixed tempo constant).
This raw number is in *seconds, at the reference tempo* (the Tempo slider's
midpoint, 50) - `Shape/Synth.js`'s `part.playbackRate = tempo / 50` scales
it for whatever the Tempo slider is currently set to. Longer edges =
longer notes.

## 4. Transposition: a shape's vertical position

```js
// Shape/ContainerV2.jsx's handleDrag, and utils/shape.js's PITCH_MODIFIER_*
noteIndexModifier = parseInt(
  convertValToRange(y, 0, PITCH_MODIFIER_SPAN_PX, PITCH_MODIFIER_MAX, PITCH_MODIFIER_MIN),
  10
)
// PITCH_MODIFIER_MIN = -7, PITCH_MODIFIER_MAX = 5, PITCH_MODIFIER_SPAN_PX = 900
// convertValToRange is unclamped linear interpolation - a shape dragged
// past the 900px span keeps extrapolating beyond -7/5, same as the
// geometry-driven noteIndex in section 3 can drift arbitrarily far too.
```

Where a shape sits *vertically* sets one integer transposition that gets
added to **every** edge's `noteIndex` for that shape - moving a shape up or
down shifts its whole melody by that many scale degrees, uniformly, without
changing the melodic shape (the sequence of turns) at all. Within the
nominal 900px span that's -7 to +5 (12 steps, ~75px each); a shape dragged
further than that keeps extrapolating past either end rather than clamping.

Recomputed by `handleDrag`, which runs once when a shape is first created
and again every time it's dragged - **not** continuously as you zoom or
pan. Two things worth knowing:

- **`y` is content-space, not screen position.** It's the shape's position
  relative to the canvas's own coordinate system (`groupRef.current
  .position()` via `ComponentV2.jsx`'s `getPosition` handle), deliberately
  *not* `getAbsolutePosition()` (which includes the Stage's zoom/pan
  transform). This was a real bug fixed earlier in this project's history:
  using absolute/screen position meant zooming or panning could silently
  change what note a shape would get if dragged, even though the shape
  itself hadn't moved in the actual composition. Content-space position
  means a shape's transposition only ever changes when *you* move it.
- **It's not re-evaluated by playback.** A shape's `noteIndexModifier` is a
  snapshot from the last time it was dragged (or created) - moving the
  Toolbar's Key/Scale dropdowns changes `scaleObj` live, but moving a shape
  only takes effect the next time you actually drag it.

The *horizontal* (x) position of a shape is computed in this same function
and works the same way, but controls **stereo pan** (-1 to 1 across the
canvas width), not pitch - included here because it's easy to conflate the
two, but it's an entirely separate output derived from the same drag event.

## 5. From scale degree to actual sound

```js
// Shape/Synth.js, inside the per-edge Tone.Part callback
scaleObj.get(val.noteIndex + noteIndexModifier)
```

This produces a real Teoria `Note` (a specific pitch + octave). What
happens to it next depends on the instrument assigned to the shape's color:

- **Built-in (Tone.js) instrument**: `.toString()` gives a note name like
  `"c#4"`, passed straight to `synth.triggerAttackRelease(...)`.
- **SoundFont (SF2) instrument**: `.midi()` gives a MIDI note number,
  passed to `utils/sf2Engine.js`'s `noteOn`/`noteOff` on that color's MIDI
  channel (colorIndex doubles as the channel number, 0-15).

Both paths share the exact same `noteIndex`/`noteIndexModifier` math above
- the instrument only changes how the resulting pitch is actually voiced,
never what that pitch *is*.

## 6. The exception: imported MIDI shapes

A shape created from **MIDI import** carries its own exact
`{ midi, duration }` per edge (one per original imported note), instead of
being derived from geometry at all:

```js
// Shape/Synth.js
const midiNote = val.midi !== undefined
  ? val.midi + noteIndexModifier       // semitones, not scale degrees
  : Math.round(scaleObj.get(val.noteIndex + noteIndexModifier).midi());
```

Note the unit change: for an imported shape, `noteIndexModifier` (the exact
same value, computed the exact same way from vertical position) is added
as a **plain semitone shift** directly to the imported MIDI number, *not*
as a scale-degree offset - there's no scale degree to offset, since the
pitch didn't come from `scaleObj` in the first place. Dragging an imported
shape up/down still transposes it, just in semitones instead of scale
steps.

This only holds as long as the shape's vertex count still matches its
original imported note count 1:1. Adding or deleting a vertex breaks that
alignment, and the shape permanently falls back to the normal
geometry-driven path (§3) from that point on - checked every render via
`noteEvents.length === points.length / 2` in both `Shape/ContainerV2.jsx`
and `Shape/useShapeSynth.js`.

## 7. Clamping (export only)

Because `noteIndex` is an unbounded running total (§3c), a shape with many
sharp-turning edges can drift its scale degree far from where it started -
`scaleObj.get()` will happily keep returning notes many octaves out. Live
playback (Tone.js, the SF2 engine) has no range limit and just plays
whatever pitch results, however high or low.

The one place this *is* clamped is MIDI export
(`utils/shape.js`'s `getClampedMidiNoteNumber`, used by
`convertPointsToMIDINoteEvents`): the `.midi()` value is clamped to the
valid 0-127 MIDI byte range before being written to a `.mid` file, since
the MIDI writer library doesn't validate this itself and will silently
write a corrupt file otherwise. This clamp only affects the exported file,
never what you hear in the app.

## Quick reference

| Concern | Source |
|---|---|
| Project key/scale | `utils/project.js` (`scaleObj`), Toolbar Key/Scale dropdowns |
| Turn angle -> scale-degree jump | `utils/shape.js`: `getAngle`, `thetaToScaleDegree` |
| Per-edge walk / note duration | `utils/shape.js`: `getNoteInfo`, `walkNoteEvents` |
| Starting note | `Shape/ContainerV2.jsx` initial state, `firstNoteIndex: 1` |
| Transposition from vertical position | `Shape/ContainerV2.jsx`'s `handleDrag`; constants in `utils/shape.js` (`PITCH_MODIFIER_MIN/MAX/SPAN_PX`) |
| Horizontal position -> stereo pan | `Shape/ContainerV2.jsx`'s `handleDrag` (`panVal`) |
| Scale degree -> actual playback | `Shape/Synth.js`'s `Tone.Part` callback |
| Imported-MIDI exception path | `Shape/Synth.js`, `Shape/ContainerV2.jsx`, `Shape/useShapeSynth.js` (the `noteEvents.length === points.length / 2` check) |
| MIDI export clamping | `utils/shape.js`'s `getClampedMidiNoteNumber` |
