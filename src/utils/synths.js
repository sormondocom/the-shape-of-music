import { SYNTH_PRESETS } from 'instrumentPresets';
import {
  isSf2Reference,
  makeSf2Reference,
  parseSf2Program,
  isSustainedProgram,
  SF2_DYNAMIC_PARAMS,
} from 'utils/sf2Engine';

// Slot 0 (the one active instrument on a fresh project - see
// utils/project.js's activeColorIndices, default [0]) is Grand Piano, GM
// program 0 of whatever SoundFont is loaded (utils/sf2Engine.js) - this is
// just a string value, independent of whether the engine has actually
// finished loading yet.
const GRAND_PIANO = makeSf2Reference(0);

// The other 15 slots are placeholders, never shown until the user adds
// them (ADD_INSTRUMENT_CHANNEL in Project/index.jsx's reducer) - each
// defaults to Grand Piano too when first added, same as slot 0.
export const DEFAULT_SYNTHS = Array.from({ length: 16 }, () => GRAND_PIANO);

export const getDefaultParamValues = synthType => {
  // SF2 instruments share one fixed dynamicParams set (GM MIDI CC
  // effects - see utils/sf2Engine.js's SF2_DYNAMIC_PARAMS) rather than
  // per-instrument custom ones.
  const dynamicParams = isSf2Reference(synthType)
    ? SF2_DYNAMIC_PARAMS
    : SYNTH_PRESETS[synthType].dynamicParams;
  return dynamicParams.map(param => param.default);
};

// Tone.js envelope "sustain" is a 0-1 fraction of peak amplitude the note
// holds at once the key is down (the inverse-scaled equivalent of SF2's
// centibel sustainVolEnv - see utils/sf2Engine.js's isSustainedProgram).
// Built-in presets' params shapes vary by synth type (Tone.Synth has one
// top-level envelope; Tone.DuoSynth/FMSynth layer two, under varying key
// names) - rather than hand-coding each shape, just walk the whole params
// tree and take the highest "sustain" found anywhere in it: if any
// layer/voice rings on, the instrument reads as sustained overall. A
// Sampler-based preset (e.g. Grand Piano) has no envelope.sustain at all,
// which correctly falls through to "not sustained" - a real piano note
// decays on its own regardless of how long the key is held.
const SUSTAIN_THRESHOLD = 0.3;

const findMaxSustain = node => {
  if (!node || typeof node !== 'object') return 0;
  let max = typeof node.sustain === 'number' ? node.sustain : 0;
  Object.keys(node).forEach(key => {
    if (key === 'sustain') return;
    const childMax = findMaxSustain(node[key]);
    if (childMax > max) max = childMax;
  });
  return max;
};

export const isSustainedSynthType = synthType => {
  const preset = SYNTH_PRESETS[synthType];
  if (!preset) return false;
  return findMaxSustain(preset.params) >= SUSTAIN_THRESHOLD;
};

// Unified "does this instrument ring on while a note is held" check,
// dispatching to the SF2 or built-in classifier as appropriate - the one
// callers (the shape notation tick, Shape/ComponentV2.jsx) should use,
// regardless of which kind of instrument a color is currently assigned.
export const isSustainedInstrument = selectedSynth => {
  if (isSf2Reference(selectedSynth)) {
    return isSustainedProgram(parseSf2Program(selectedSynth));
  }
  return isSustainedSynthType(selectedSynth);
};
