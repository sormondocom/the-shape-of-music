import Tone from 'tone';
import { WorkletSynthesizer } from 'spessasynth_lib';
import { SoundBankLoader, BasicSoundBank, GeneratorTypes } from 'spessasynth_core';
import { SEND_CHANNELS } from 'utils/music';
import { convertValToRange } from 'utils/math';

/*
  Shared SF2/SF3 playback engine - ONE WorkletSynthesizer instance for the
  whole app (spessasynth_lib's own docs explicitly warn against running
  multiple instances - "the SoundBankManager and one instance should be
  sufficient, especially when using more than 16 channels").

  Important architecture note: unlike the per-shape Tone.js synths
  (Shape/Synth.js), this engine has only ONE live audio output - its
  .connect() gives the combined mix of all 16 MIDI channels together, not
  a separate tap per channel (the "16 dry outputs" that exist are for
  OFFLINE rendering only, per the library's own docs on getMergedOutput()).
  So SF2-backed colors:
  - DO get independent volume/pan/mute/solo - via real per-channel MIDI CC
    messages (controllerChange), not separate Tone.Panner/Gain nodes.
  - do NOT get Proximity Mode's 3D spatial audio or per-color custom
    effects (reverb/delay knobs) - there's no separate node to attach
    those to once 16 channels are already mixed together.
  Confirmed with Shawn before building this - see the plan file / session
  history for the full tradeoff discussion.
*/

const DEFAULT_SOUNDFONT_URL = '/soundfonts/default.sf2';
const DEFAULT_SOUNDFONT_NAME = 'GeneralUser GS (default)';
const BANK_ID = 'main';

const MIDI_CC = {
  VOLUME: 7,
  PAN: 10,
  // Standard GM/GS controllers - all confirmed wired to real, audible DSP
  // in spessasynth_core (not just stored inert values): REVERB_SEND/
  // CHORUS_SEND feed the engine's own built-in reverb/chorus processors
  // (enabled by default - effectsEnabled: true), and BRIGHTNESS/
  // VIBRATO_DEPTH drive real default modulators (brightness -> filter
  // cutoff, vibrato depth -> pitch LFO amount) baked into every GM-
  // compliant SoundFont. Same mechanism as VOLUME/PAN above - per-channel
  // MIDI CC messages, no separate audio node needed.
  BRIGHTNESS: 74,
  VIBRATO_DEPTH: 77,
  REVERB_SEND: 91,
  CHORUS_SEND: 93,
};

let synth = null;
let readyPromise = null;
let currentSoundFontName = null;
let isLoadingDefault = false;
const listeners = new Set();

// Separate, main-thread-only parse of the SAME SoundFont data, purely for
// metadata queries (see isSustainedProgram below) - the WorkletSynthesizer
// above does its own internal parsing inside the AudioWorklet thread (a
// separate JS context), which isn't queryable from here at all. Parsing
// again is cheap relative to the audio engine's own setup, and
// SoundBankLoader/BasicSoundBank are a regular (non-worklet) part of
// spessasynth_core, usable standalone for exactly this kind of thing.
let metadataSoundBank = null;
const sustainedProgramCache = new Map();

const notify = () => {
  listeners.forEach(fn => fn(getSf2State()));
};

export const getSf2State = () => ({
  currentSoundFontName,
  isLoadingDefault,
});

export const subscribeSf2Engine = fn => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const WORKLET_PROCESSOR_URL = '/spessasynth_processor.min.js';

// Lazily created - AudioContext/AudioWorklet need a user gesture to start
// anyway, so there's no benefit to creating this at module load time.
//
// Deliberately does NOT touch AudioContext.resume() here - this is also the
// path loadSoundFont/loadDefaultSoundFont go through to fetch/parse/register
// SoundFont data, which runs automatically on mount with no user gesture
// behind it. A suspended context can still be set up and loaded into just
// fine; resume() is only needed once something is actually meant to be
// audible, and browsers will leave that promise pending forever if it's
// called before any user gesture has happened anywhere on the page - adding
// it here previously made the automatic default-SoundFont load hang
// indefinitely. See ensureEngineReady() for the resume step.
const ensureSynth = async () => {
  if (synth) {
    await readyPromise;
    return synth;
  }

  const rawContext = Tone.context.rawContext;
  // the AudioWorkletNode's processor module has to be registered on the
  // context before WorkletSynthesizer can construct one - copied from
  // node_modules/spessasynth_lib/dist into public/ so it's servable as a
  // static asset (addModule fetches it by URL, same as a Worker script)
  await rawContext.audioWorklet.addModule(WORKLET_PROCESSOR_URL);
  synth = new WorkletSynthesizer(rawContext);
  readyPromise = synth.isReady;
  await readyPromise;

  // one shared bus for the engine's single combined output - feeds the
  // same master-output send every other sound in the app already uses
  const bus = new Tone.Gain(1);
  bus.send(SEND_CHANNELS.MASTER_OUTPUT, 0);
  synth.connect(bus.input);

  return synth;
};

export const loadSoundFont = async (arrayBuffer, name) => {
  // Parsed BEFORE addSoundBank below, which hands the same buffer off to
  // the AudioWorklet (likely as a transferable, which would detach it) -
  // this parse is a synchronous, non-destructive read, so ordering it
  // first means both consumers get a valid buffer regardless of how
  // addSoundBank moves it around afterward.
  try {
    await BasicSoundBank.ready; // needed once, globally, for SF3/SF2Pack decoding
    metadataSoundBank = SoundBankLoader.fromArrayBuffer(arrayBuffer);
  } catch (err) {
    // Non-fatal - this only powers the sustain-note notation (Sheet
    // Preview-adjacent, not playback itself), so a parse failure here
    // shouldn't block the actual SoundFont from loading and playing.
    metadataSoundBank = null;
  }
  sustainedProgramCache.clear();

  const s = await ensureSynth();
  // addSoundBank replaces any existing bank with the same id, so reusing
  // one fixed id gives "upload a new one replaces the previous" for free
  await s.soundBankManager.addSoundBank(arrayBuffer, BANK_ID);
  currentSoundFontName = name;
  notify();
};

export const loadDefaultSoundFont = async () => {
  if (currentSoundFontName || isLoadingDefault) return;
  isLoadingDefault = true;
  notify();
  try {
    const response = await fetch(DEFAULT_SOUNDFONT_URL);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await loadSoundFont(buffer, DEFAULT_SOUNDFONT_NAME);
  } finally {
    isLoadingDefault = false;
    notify();
  }
};

// Returns [{ name, program, bankMSB, bankLSB, isDrum }] from the
// currently loaded soundfont, or [] if none is loaded yet.
export const getPresetList = () => (synth ? synth.presetList : []);

// SF2's volume envelope "sustain" generator (sustainVolEnv, #37) is a
// centibel ATTENUATION level the note settles at once held - 0 (the SF2
// default) means it holds at full volume for as long as the key is down
// (a genuinely sustained instrument: organ, pad, strings, held brass); a
// high value means it decays to near/total silence even while still held
// (a plucked/struck one: piano, pizzicato, mallet - "sustaining" it just
// holds silence). 900 mirrors PERCEIVED_CB_SILENCE, the threshold
// spessasynth_core's own synthesis engine uses internally for this exact
// distinction (voice.js - decides whether a voice can be treated as
// silent once it reaches sustain) - not an arbitrary number of our own.
const SUSTAIN_SILENCE_THRESHOLD_CB = 900;
// Representative note/velocity for classification - some instruments
// layer differently-enveloped samples across the key/velocity range, but
// a single reasonable sample point is enough for a best-effort notation
// mark, not a per-note-exact analysis.
const CLASSIFICATION_NOTE = 60; // middle C
const CLASSIFICATION_VELOCITY = 100;

export const isSustainedProgram = program => {
  if (sustainedProgramCache.has(program)) {
    return sustainedProgramCache.get(program);
  }
  let result = false;
  if (metadataSoundBank) {
    try {
      const preset = metadataSoundBank.getPreset(
        { program, bankMSB: 0, bankLSB: 0 },
        'gs'
      );
      const voices = preset.getVoiceParameters(
        CLASSIFICATION_NOTE,
        CLASSIFICATION_VELOCITY
      );
      // "sustained" if ANY layered voice rings on, not just the first -
      // e.g. a pad layered under a pluck should still read as sustained
      result = voices.some(
        v => v.generators[GeneratorTypes.sustainVolEnv] < SUSTAIN_SILENCE_THRESHOLD_CB
      );
    } catch (err) {
      result = false;
    }
  }
  sustainedProgramCache.set(program, result);
  return result;
};

// For callers that can afford to actually wait (a one-off preview click,
// unlike the hot note-triggering path below) rather than fire-and-forget -
// guarantees the AudioContext is resumed and the engine is set up before
// returning, so a noteOn right after this is guaranteed to be audible
// instead of racing ahead of context-resume/setup.
//
// Only call this from a genuinely user-gesture-triggered code path (e.g. a
// click handler). Unlike ensureSynth(), this does resume the AudioContext -
// safe here because every current caller (instrumentPreview.js's preview
// click) only runs in direct response to a click, which is exactly the kind
// of gesture browsers require before they'll resolve resume() at all.
export const ensureEngineReady = async () => {
  await Tone.context.resume();
  return ensureSynth();
};

// Deliberately NOT async, unlike loadSoundFont/loadDefaultSoundFont -
// every caller (Synth.js's Tone.Part callback, utils/instrumentPreview.js)
// calls this immediately followed by a synchronous noteOn, without
// awaiting it. If this always went through `await ensureSynth()`, that
// await would defer the actual programChange call to a later microtask -
// but the following noteOn() is plain, synchronous code, so it would
// ALWAYS run first and play the PREVIOUS program, one note/preview behind,
// every single time the engine is already warm (the overwhelming common
// case - it only loads once). Fast path: apply immediately and
// synchronously when the engine already exists; only fall back to the
// async setup path on the very first call anywhere in the app, before the
// engine exists yet (a one-time, rare case where a noteOn that follows
// immediately will simply no-op until setup finishes, same as it already
// does today).
export const programChange = (channel, program) => {
  if (synth) {
    synth.programChange(channel, program);
    return;
  }
  ensureSynth().then(s => s.programChange(channel, program));
};

// eventOptions ({ time }, in AudioContext seconds - the same clock Tone.js
// already schedules against, since this engine shares Tone's own raw
// AudioContext - see ensureSynth()) lets Shape/Synth.js schedule noteOff
// for the actual future moment a note should end, rather than it firing
// immediately. WorkletSynthesizer.noteOn/noteOff both accept this natively
// (SynthMethodOptions) - previously dropped here, which meant every SF2
// note's noteOff fired at the same instant as its noteOn, cutting it off
// right after the attack. Invisible for naturally-decaying instruments
// (piano, plucked strings - they fade on their own regardless of noteOff
// timing), but it meant genuinely sustained instruments (organ, pads,
// strings) never actually got to sustain at all.
export const noteOn = (channel, midiNote, velocity, eventOptions) => {
  if (!synth) return;
  synth.noteOn(channel, midiNote, velocity, eventOptions);
};

export const noteOff = (channel, midiNote, eventOptions) => {
  if (!synth) return;
  synth.noteOff(channel, midiNote, eventOptions);
};

// MIDI "panic" - immediately silences every currently-sounding note on
// every channel, right now, regardless of whatever noteOff each one has
// already scheduled for later. Clearing the canvas (or importing a new
// file, which clears first) disposes every shape's own Tone.Part, but
// that only stops SCHEDULING new notes - any note already triggered
// keeps ringing until ITS OWN scheduled noteOff/natural decay, which for
// a genuinely sustained instrument (Shape/useShapeSynth.js's isSustained)
// can be seconds away. That's the "stops eventually, with some delay"
// symptom - force=true here means stop immediately, not a graceful
// release.
export const stopAllNotes = () => {
  if (!synth) return;
  synth.stopAll(true);
};

export const setChannelVolume = (channel, volume0to127) => {
  if (!synth) return;
  synth.controllerChange(channel, MIDI_CC.VOLUME, volume0to127);
};

export const setChannelPan = (channel, pan0to127) => {
  if (!synth) return;
  synth.controllerChange(channel, MIDI_CC.PAN, pan0to127);
};

export const setChannelController = (channel, ccNumber, value0to127) => {
  if (!synth) return;
  synth.controllerChange(channel, ccNumber, value0to127);
};

// Knob-ready (0-100 in, like every built-in instrument's dynamicParams -
// see instrumentPresets/*.js) wrapper around a single CC send.
const ccKnobFunc = ccNumber => (channel, val) =>
  setChannelController(
    channel,
    ccNumber,
    Math.round(convertValToRange(val, 0, 100, 0, 127))
  );

/*
  The SF2-equivalent of a built-in instrument's dynamicParams (utils/synths
  .js's getDefaultParamValues, Shape/Synth.js's setKnobValues,
  ColorControllerPanel/ColorController/Component.jsx's knob row) - one
  fixed set shared by every SoundFont-backed color, rather than per-
  instrument custom params, since all SF2 instruments speak the same GM
  controller vocabulary regardless of which program is selected.

  Reverb/Chorus default to 0 (GM's own silent-send default - a freshly
  added instrument starts dry, matching vanilla GM playback). Brightness/
  Vibrato default to 50 (knob midpoint -> CC ~64, GM's own neutral reset
  value for both - starting at the knob's zero position would otherwise
  make a fresh instrument sound artificially duller/flatter than its
  intended default tone, not "off").
*/
export const SF2_DYNAMIC_PARAMS = [
  { name: 'reverb', default: 0, func: ccKnobFunc(MIDI_CC.REVERB_SEND) },
  { name: 'chorus', default: 0, func: ccKnobFunc(MIDI_CC.CHORUS_SEND) },
  { name: 'brightness', default: 50, func: ccKnobFunc(MIDI_CC.BRIGHTNESS) },
  { name: 'vibrato', default: 50, func: ccKnobFunc(MIDI_CC.VIBRATO_DEPTH) },
];

/*
  selectedSynths (utils/synths.js, Project reducer state) stays a plain
  array of strings - a built-in type name (e.g. "KEYS") or, for an SF2
  instrument, this "SF2:<program>" convention - so saved-project
  serialization doesn't need to change shape at all.

  The actual functions live in utils/sf2Reference.js now (pure string
  formatting/parsing, no audio engine dependency - see that file's own
  comment for why) - re-exported here unchanged so nothing that already
  imports them from this file needs to change.
*/
export { makeSf2Reference, isSf2Reference, parseSf2Program } from './sf2Reference';

// dB (Tone.js convention, roughly -18 to 0 in this app) -> MIDI CC 0-127
export const dbToMidiCC = db => {
  const linear = Math.pow(10, db / 20);
  return Math.max(0, Math.min(127, Math.round(linear * 127)));
};

// Tone.Panner convention (-1 to 1) -> MIDI CC 0-127 (64 = center)
export const panToMidiCC = pan => Math.max(0, Math.min(127, Math.round((pan + 1) * 63.5)));
