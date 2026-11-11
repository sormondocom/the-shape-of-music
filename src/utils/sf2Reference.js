/*
  Pure string encoding for "this colorIndex plays SF2 program N" - split
  out from utils/sf2Engine.js on purpose: everything else in that file
  touches the actual audio engine (Tone.js, the AudioWorklet synthesizer),
  which only exists in a browser. These three functions don't - they're
  just string formatting/parsing - so anything that only needs to KNOW
  about SF2 program references (not actually play them) can depend on
  this instead and stay usable outside a browser entirely. utils/
  midiImport.js is the reason this file exists: scripts/exportLineArt.js
  (a plain Node CLI) needs it for MIDI -> shape conversion, and pulling in
  the whole audio engine to get three string-utility functions would make
  that impossible.

  sf2Engine.js re-exports all three unchanged, so nothing that already
  imports them from there needs to change.
*/

const SF2_PREFIX = 'SF2:';

export const makeSf2Reference = program => `${SF2_PREFIX}${program}`;

export const isSf2Reference = value =>
  typeof value === 'string' && value.startsWith(SF2_PREFIX);

export const parseSf2Program = value => parseInt(value.slice(SF2_PREFIX.length), 10);
