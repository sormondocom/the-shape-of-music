import { useState, useEffect } from 'react';
import Tone from 'tone';
import { SEND_CHANNELS } from 'utils/music';
import { stopAllNotes } from 'utils/sf2Engine';
import { silenceAllSynths } from 'components/Shape/Synth';

export const useAudioOutput = () => {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // Trades a bit of latency for a lot of glitch tolerance. Tone.js
    // schedules every note this.lookAhead seconds before it's actually
    // due, specifically so a brief main-thread stall (a heavy React re-
    // render, a Konva redraw - PlayBar's zoom-settle commit recomputing
    // every shape's decimated points is the known one) doesn't make it
    // miss that note's moment entirely. The default ('interactive', 0.1s)
    // is tuned for a virtual instrument you're playing live, where low
    // latency matters more than the occasional glitch - nothing here is
    // triggered by a live keypress, every note is pre-scheduled from a
    // shape, so there's no real-time feel to protect by keeping it low.
    Tone.context.latencyHint = 'playback';

    /* master output */
    const masterCompressor = new Tone.Compressor({
      ratio: 16,
      threshold: -30,
      release: 0.25,
      attack: 0.003,
      knee: 30,
    });

    const masterLimiter = new Tone.Limiter(-2);
    const masterOutput = new Tone.Gain(0.9).receive(
      SEND_CHANNELS.MASTER_OUTPUT
    );
    masterOutput.chain(masterCompressor, masterLimiter, Tone.Master);
    return () => {
      Tone.Transport.stop();
      masterCompressor.dispose();
      masterLimiter.dispose();
      masterOutput.dispose();
    };
  }, []);

  const toggleIsPlaying = () => {
    // pause (not stop) - Transport.stop() resets its position back to 0,
    // which would make PlayBar's "manually advance a paused track" pretty
    // pointless (there'd be nothing to resume FROM, every pause already
    // having thrown the position away). pause() leaves Transport.seconds
    // exactly where it was, so a scrub-while-paused actually sticks.
    if (isPlaying) {
      Tone.Transport.pause();
    } else {
      Tone.Transport.start();
    }
    setIsPlaying(!isPlaying);
  };

  // The genuine reset-to-0 action, distinct from pausing - PlayBar's own
  // Stop button, separate from its Play/Pause one. stopAllNotes() (not
  // Transport.cancel() - nothing's being disposed/replaced here, so every
  // shape's own already-scheduled notes are still valid and should stay
  // queued for when playback resumes) silences anything still ringing
  // from a sustained instrument immediately, rather than leaving it to
  // decay/reach its own scheduled noteOff on its own time.
  const stop = () => {
    Tone.Transport.stop();
    stopAllNotes();
    // stopAllNotes() above is the SF2 engine's own panic - it doesn't
    // touch the OTHER per-shape Tone.js synths (built-in presets), which
    // schedule their own noteOn/noteOff on real AudioContext time
    // (Shape/Synth.js's triggerAttackRelease) entirely independent of
    // Transport state once triggered. A sustained instrument's held note
    // would otherwise keep ringing until its own originally-scheduled
    // release, regardless of how many times Stop is pressed. This is the
    // equivalent hard-cutoff for those.
    silenceAllSynths();
    setIsPlaying(false);
  };

  // Jumps the playhead back to 0 - ALSO pauses now (see the bug this
  // fixed: clearing/importing while playback was running left the
  // Transport ticking straight through the reset, so the freshly-mounted
  // new content started sounding immediately with no Play press at all -
  // the exact "picks up where the old one left off" symptom below, just
  // for the NEW content instead of a stale old one). Clearing the canvas
  // (the explicit Clear button, and MIDI import's own clear-first
  // behavior) calls this: without the position reset specifically, a new
  // import mounts its shapes while Transport.seconds is still wherever it
  // was left (if nothing ever paused/stopped it) - each shape's
  // startOffset is scheduled as an absolute Transport time, which, if
  // already in the past by the time the shape mounts, Tone.js just
  // starts immediately rather than waiting for it, landing the shape
  // somewhere mid-loop based on the STALE position instead of at the
  // beginning of its own content. Visibly, that reads as the new import
  // "picking up where the old one left off" - a phase carried over by
  // accident, not anything about the new file itself.
  //
  // Two more things bundled in here, both needed for a genuinely clean
  // slate rather than just a reset number:
  // - Transport.cancel() clears every already-scheduled callback (each
  //   shape's Tone.Part schedules its notes as absolute Transport ticks).
  //   Disposing a shape's Part stops it from scheduling anything NEW, but
  //   doesn't retroactively unschedule what it already queued - and since
  //   we just rewound the clock, those stale callbacks are sitting at
  //   tick values the Transport hasn't reached YET from its new position
  //   0, so if playback keeps running, it will eventually reach them
  //   again and fire them a second time. That's the "new import picks up
  //   at the same location in the timing" symptom - it's not the new
  //   shapes misbehaving, it's old ones replaying themselves.
  // - stopAllNotes() is the SF2 engine's own MIDI panic - every SF2
  //   channel is one shared, persistent AudioWorklet instance, not
  //   something that gets disposed with its shape, so a note already
  //   triggered (especially a genuinely sustained one - Shape/
  //   useShapeSynth.js's isSustained) keeps ringing on its own schedule
  //   regardless of Transport.cancel() above. This is the "stops
  //   eventually, with some delay" half of the same bug report.
  const resetPosition = () => {
    // Halt the clock BEFORE touching anything else below, so nothing can
    // tick forward mid-reset and schedule/trigger against a half-reset
    // state. pause() (not stop()) because the position is being set
    // explicitly right after anyway - no need for stop()'s own implicit
    // rewind too.
    Tone.Transport.pause();
    Tone.Transport.cancel(0);
    Tone.Transport.seconds = 0;
    stopAllNotes();
    // Same non-SF2 half of the panic as stop() above - see its own
    // comment. A new MIDI/geo import landing on top of a still-sustaining
    // note from the previous one is the same bug, just reached from here
    // instead of the Stop button.
    silenceAllSynths();
    setIsPlaying(false);
  };

  return {
    isPlaying,
    toggleIsPlaying,
    stop,
    resetPosition,
  };
};
