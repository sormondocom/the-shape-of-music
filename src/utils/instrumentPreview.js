import Tone from 'tone';
import { SYNTH_PRESETS } from 'instrumentPresets';
import * as sf2Engine from 'utils/sf2Engine';
import { isSf2Reference, parseSf2Program } from 'utils/sf2Engine';

/*
  Plays a single short note on a given instrument so it can be auditioned
  without drawing a shape.

  Built-in presets: a throwaway Tone.js synth, connected straight to the
  master output (bypassing panning/solo/per-color effects, which don't
  matter for "what does this instrument sound like"), disposed after it's
  done playing. Mirrors the loading-state handling Shape/Synth.js already
  uses: for a Tone.Sampler-based preset (e.g. the piano), the second
  constructor arg is a real "samples finished loading" callback and
  playback has to wait for it; for every other preset type it's simply
  unused, so triggering immediately is safe.

  SF2 programs: there's only ONE shared engine instance for the whole app
  (utils/sf2Engine.js) - this borrows channel 15 (the same channel color
  slot 16 would use for real playback, if any shape is assigned to it).
  Shape/Synth.js re-asserts its own channel's program on every note it
  plays specifically to stay correct regardless of this kind of transient
  borrowing, so there's no lasting collision.
*/

const PREVIEW_NOTE_NAME = 'C4';
const PREVIEW_MIDI_NOTE = 60;
const PREVIEW_DURATION = '8n';
const PREVIEW_LIFETIME_MS = 1500;
const SF2_PREVIEW_CHANNEL = 15;

let activePreview = null; // { stop: () => void }

const disposeActivePreview = () => {
  if (!activePreview) return;
  activePreview.stop();
  activePreview = null;
};

const previewSf2 = (program, { onStart, onEnd }) => {
  // Unlike the hot note-triggering path in Shape/Synth.js, a preview click
  // can afford to actually wait: ensureEngineReady() resumes the shared
  // AudioContext (browsers suspend it until a user gesture resumes it -
  // Tone.js's own high-level APIs do this automatically for built-ins,
  // but this engine talks to the raw context directly) and finishes any
  // one-time setup, so programChange/noteOn below are guaranteed audible
  // instead of racing ahead of context-resume on the very first SF2
  // interaction (no error either way - the calls "succeed", the audio
  // just never gets produced).
  let cancelled = false;
  let stopTimeoutId = null;
  activePreview = {
    stop: () => {
      cancelled = true;
      clearTimeout(stopTimeoutId);
      sf2Engine.noteOff(SF2_PREVIEW_CHANNEL, PREVIEW_MIDI_NOTE);
    },
  };
  if (onStart) onStart();
  sf2Engine.ensureEngineReady().then(() => {
    if (cancelled) return;
    sf2Engine.programChange(SF2_PREVIEW_CHANNEL, program);
    sf2Engine.noteOn(SF2_PREVIEW_CHANNEL, PREVIEW_MIDI_NOTE, 100);
    stopTimeoutId = setTimeout(() => {
      disposeActivePreview();
      if (onEnd) onEnd();
    }, PREVIEW_LIFETIME_MS);
  });
};

const previewBuiltIn = (synthType, { onStart, onEnd }) => {
  const preset = SYNTH_PRESETS[synthType];
  if (!preset) return;

  const play = synth => {
    synth.toMaster();
    synth.triggerAttackRelease(PREVIEW_NOTE_NAME, PREVIEW_DURATION);
    const stopTimeoutId = setTimeout(() => {
      disposeActivePreview();
      if (onEnd) onEnd();
    }, PREVIEW_LIFETIME_MS);
    activePreview = {
      synth,
      stop: () => {
        clearTimeout(stopTimeoutId);
        synth.disconnect();
        synth.dispose();
      },
    };
  };

  const synth = new preset.baseSynth(preset.params, () => {
    // samples finished loading (Sampler-only) - play now
    if (activePreview && activePreview.synth === synth) {
      play(synth);
    }
  });

  if (synth instanceof Tone.Sampler) {
    // still loading - if another preview is triggered before this one's
    // samples finish, make sure this one still gets cleaned up rather
    // than orphaned
    activePreview = {
      synth,
      stop: () => {
        synth.disconnect();
        synth.dispose();
      },
    };
    if (onStart) onStart();
  } else {
    play(synth);
  }
};

export const previewInstrument = (value, { onStart, onEnd } = {}) => {
  disposeActivePreview();

  if (isSf2Reference(value)) {
    previewSf2(parseSf2Program(value), { onStart, onEnd });
  } else {
    previewBuiltIn(value, { onStart, onEnd });
  }
};
