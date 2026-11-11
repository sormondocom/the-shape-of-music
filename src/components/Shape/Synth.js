import Tone from 'tone';
import { SYNTH_PRESETS } from 'instrumentPresets';
import { SEND_CHANNELS } from 'utils/music';
import { forEachPoint, getNoteInfo } from 'utils/shape';
import { DEFAULT_PROXIMITY_MODE_RADIUS } from 'utils/project';
import * as sf2Engine from 'utils/sf2Engine';
import {
  isSf2Reference,
  parseSf2Program,
  dbToMidiCC,
  panToMidiCC,
  SF2_DYNAMIC_PARAMS,
} from 'utils/sf2Engine';

export function Synth({ onStartLoading, onEndLoading }) {
  console.log('Synth constructed');

  let noteIndexModifier = 0;
  let isPlayingAnimator = () => {};
  let synth = null;
  let isBuffering = false;

  // SF2-backed colors have no per-shape Tone.js synth/panner/solo/gain
  // chain at all (see utils/sf2Engine.js's header comment for why) -
  // volume/pan/mute/solo are instead applied as real-time MIDI CC
  // messages on this shape's dedicated channel (colorIndex doubles as the
  // MIDI channel number, 0-15).
  let isSf2 = false;
  let sf2Channel = null;
  let sf2Program = null;
  let isMuted = false;
  let isSoloed = false;
  let isAnyShapeSoloed = false;

  const applySf2Volume = () => {
    if (!isSf2) return;
    const silent = isMuted || (isAnyShapeSoloed && !isSoloed);
    sf2Engine.setChannelVolume(sf2Channel, silent ? 0 : dbToMidiCC(volume));
  };

  const applySf2Pan = () => {
    if (!isSf2) return;
    // SF2 channels don't get Proximity Mode's 3D panning (no separate
    // node to attach a Panner3D to) - always just the plain 2D pan
    sf2Engine.setChannelPan(sf2Channel, panToMidiCC(panVal || 0));
  };

  const part = new Tone.Part((time, val) => {
    // Two different "how long" values, both derived from val.duration (the
    // scheduling gap to the next note's onset) unless a rest shortens the
    // actual sound (val.ringDuration, always <= duration - see
    // utils/midiImport.js). The progress dot travels the edge at
    // edgeDuration - it has to, since the edge's pixel length was built
    // from this same gap (utils/midiImport.js's `dist`), so arriving
    // early/idling or arriving late would visibly desync the dot from the
    // shape it's tracing. soundDuration is the actual noteOn-to-noteOff
    // length - shorter than edgeDuration exactly when there's a rest to
    // leave silent before the next note fires.
    const edgeDuration = val.duration / part.playbackRate;
    const soundDuration =
      (val.ringDuration !== undefined ? val.ringDuration : val.duration) / part.playbackRate;
    // animation
    Tone.Draw.schedule(isPlayingAnimator(val, edgeDuration), time);

    // an imported MIDI note carries its own exact pitch - play it directly
    // (noteIndexModifier becomes a plain semitone shift here, since there's
    // no scale degree to offset); otherwise derive the note from the
    // shape's geometry as usual
    // Real dynamics from an imported MIDI file (@tonejs/midi's normalized
    // 0-1 velocity, carried through utils/midiImport.js) - undefined for
    // geometry-driven notes, which never had a velocity to begin with, so
    // those keep playing at the same fixed level as before.
    const hasImportedVelocity = val.velocity !== undefined;

    if (isSf2) {
      const midiNote =
        val.midi !== undefined
          ? val.midi + noteIndexModifier
          : Math.round(scaleObj.get(val.noteIndex + noteIndexModifier).midi());
      const velocity = hasImportedVelocity ? Math.round(val.velocity * 127) : 100;
      // re-assert this channel's program on every note - cheap, and
      // guards against anything else transiently touching the same
      // channel number (e.g. utils/instrumentPreview.js's SF2 preview,
      // which has to borrow one of these same 16 channels to play
      // through the one shared engine instance)
      sf2Engine.programChange(sf2Channel, sf2Program);
      sf2Engine.noteOn(sf2Channel, midiNote, velocity, { time });
      sf2Engine.noteOff(sf2Channel, midiNote, { time: time + soundDuration });
      return;
    }

    const noteString =
      val.midi !== undefined
        ? Tone.Frequency(val.midi + noteIndexModifier, 'midi').toNote()
        : scaleObj.get(val.noteIndex + noteIndexModifier).toString();
    const velocity = hasImportedVelocity ? val.velocity : 1;
    // trigger synth
    if (synth && !isBuffering) {
      synth.triggerAttackRelease(noteString, soundDuration, time, velocity);
    }
  }, []).start(0);

  part.loop = true;

  let volume = -Infinity;
  let panner = null;
  let panner3d = null;
  let pannerNode = null;

  let solo = null;
  let gain = null;

  let firstNoteIndex = 0;
  let scaleObj = null;
  let synthObj = null;
  let startOffset = 0;
  // Mirrors exactly what's been handed to part.add() in setNoteEvents/
  // setAbsoluteNoteEvents below - {delay, duration, pIndex, cursorIndex}
  // per note, in raw (pre-playbackRate) units. Kept here so the PlayBar's
  // scrub preview (getNoteAtTransportTime) can look up "what note is at
  // this position" without a live Transport tick actually having to pass
  // through the Part's own scheduled callback - there's no clean way to
  // read a Tone.Part's internal event list back out once added.
  let schedule = [];

  let isProximityMode;
  let proximityRadius;
  let avgPt;
  let panVal;

  const disposeSynth = () => {
    synth.triggerRelease();
    panner.disconnect();
    panner.dispose();
    panner3d.disconnect();
    panner3d.dispose();
    solo.disconnect();
    solo.dispose();
    gain.disconnect();
    gain.dispose();
    synth.volume.exponentialRampToValueAtTime(-Infinity, Tone.now() + 0.2);
    synth.disconnect();
    synth.dispose();
    synth = null;
  };

  return {
    setVolume: newVol => {
      volume = newVol;
      if (isSf2) {
        applySf2Volume();
      } else if (synth) {
        synth.volume.exponentialRampToValueAtTime(newVol, Tone.now() + 0.2);
      }
    },
    setSynth: (newSelectedSynth, colorIndex) => {
      sf2Channel = colorIndex;

      if (isSf2Reference(newSelectedSynth)) {
        if (synth) {
          disposeSynth();
        }
        isSf2 = true;
        sf2Program = parseSf2Program(newSelectedSynth);
        sf2Engine.programChange(sf2Channel, sf2Program);
        applySf2Volume();
        applySf2Pan();
        return;
      }

      isSf2 = false;
      synthObj = SYNTH_PRESETS[newSelectedSynth];
      if (synth) {
        disposeSynth();
      }

      synth = new synthObj.baseSynth(synthObj.params, () => {
        onEndLoading();
        isBuffering = false;
      });
      if (synth instanceof Tone.Sampler) {
        onStartLoading();
        isBuffering = true;
      }

      synth.volume.exponentialRampToValueAtTime(volume, Tone.now() + 0.2);

      panner = new Tone.Panner(0);
      panner3d = new Tone.Panner3D({
        panningModel: 'HRTF',
        positionX: 0,
        positionY: 0,
        distanceModel: 'linear',
        // distanceModel: 'inverse',
        maxDistance: proximityRadius || DEFAULT_PROXIMITY_MODE_RADIUS,
        orientationX: 1,
        orientationY: 1,
        orientationZ: 1,
      });
      panner3d._rampTimeConstant = 0.6;

      /* TODO use below functions? */
      if (panVal) {
        panner.pan.value = panVal * 0.9;
      }
      if (avgPt) {
        panner3d.positionX = avgPt.x;
        panner3d.positionY = avgPt.y;
      }
      if (isProximityMode) {
        pannerNode = panner3d;
      } else {
        pannerNode = panner;
      }

      solo = new Tone.Solo();
      // NOTE: this is where we connect to the output channel for this color
      gain = new Tone.Gain().send(`${SEND_CHANNELS.FX_PREFIX}${colorIndex}`, 0);

      synth.chain(pannerNode, solo, gain);
    },
    setKnobValues: knobVals => {
      // SF2 instruments have no per-shape effects chain (no separate node
      // to attach one to - see utils/sf2Engine.js's header comment) - the
      // knobs instead send real GM MIDI CC messages on this shape's
      // channel (SF2_DYNAMIC_PARAMS), the same mechanism volume/pan
      // already use above.
      if (isSf2) {
        knobVals.forEach((val, i) => {
          const param = SF2_DYNAMIC_PARAMS[i];
          if (param) param.func(sf2Channel, val);
        });
        return;
      }
      if (!synthObj) return;
      knobVals.forEach((val, i) => {
        if (synthObj.dynamicParams[i].target === 'instrument') {
          // TODO: confirm this works
          synthObj.dynamicParams[i].func({ synth }, val);
        }
      });
    },
    // audioScale (default 1 - ordinary musical-canvas shapes) normalizes
    // the raw content-space edge length before it becomes a duration -
    // see utils/shape.js's getNoteInfo for why this is needed at all
    // (geographic-mode shapes live in a wildly different-scaled
    // coordinate system) and ShapeCanvas/Container.jsx's appendShape/
    // importGeoShapes for where the value comes from.
    setNoteEvents: (scaleObj, points, audioScale = 1) => {
      part.removeAll();
      schedule = [];

      let delay = 0;
      let prevNoteIndex = firstNoteIndex;
      // Walks the exact same edges, in the exact same order, as utils/
      // shape.js's convertPointsToNoteEvents (Sheet Preview's data source)
      // - this running count lines up 1:1 with that array's indices, so
      // isPlayingAnimator can tell Sheet Preview which note to highlight.
      let cursorIndex = 0;

      forEachPoint(points, (p, i) => {
        if (i >= 2) {
          const noteInfo = getNoteInfo(
            points,
            scaleObj,
            i,
            i - 2,
            i - 4,
            prevNoteIndex,
            audioScale
          );
          part.add(delay, { ...noteInfo, cursorIndex });
          schedule.push({
            delay,
            duration: noteInfo.duration,
            pIndex: noteInfo.pIndex,
            cursorIndex,
          });
          delay += noteInfo.duration;
          prevNoteIndex = noteInfo.noteIndex;
          cursorIndex += 1;
        }
      });

      // last edge
      const n = points.length;
      const lastNoteInfo = getNoteInfo(
        points,
        scaleObj,
        0,
        n - 2,
        n - 4,
        prevNoteIndex,
        audioScale
      );

      part.add(delay, { ...lastNoteInfo, cursorIndex });
      schedule.push({
        delay,
        duration: lastNoteInfo.duration,
        pIndex: lastNoteInfo.pIndex,
        cursorIndex,
      });
      part.loopEnd = delay + lastNoteInfo.duration;
    },
    setAbsoluteNoteEvents: (noteEvents, points, loopDuration) => {
      part.removeAll();
      schedule = [];

      let delay = 0;
      const n = noteEvents.length;
      noteEvents.forEach((ev, k) => {
        // mirrors the wraparound convention the geometry path already uses:
        // the last note's pIndex is the points.length sentinel so the
        // perimeter-dot animator knows to travel back to vertex 0
        const pIndex = k === n - 1 ? points.length : (k + 1) * 2;
        part.add(delay, {
          midi: ev.midi,
          duration: ev.duration,
          ringDuration: ev.ringDuration,
          velocity: ev.velocity,
          pIndex,
          cursorIndex: k,
        });
        schedule.push({ delay, duration: ev.duration, pIndex, cursorIndex: k });
        delay += ev.duration;
      });
      // A MIDI import gives every shape from the same file the same
      // loopDuration (Toolbar's commonLoopDuration), covering the full
      // span from the earliest track's entrance to the latest track's own
      // ending - deliberately NOT each shape's own note total (`delay`).
      // Shapes with independently-sized loops drift apart a little more
      // every cycle (barely audible after one loop, unmistakable a dozen
      // in) even when they were never meant to - two real tracks from the
      // same file essentially never add up to the exact same real-seconds
      // span on their own. A shorter track just goes quiet for the
      // remainder of the shared period, same as it would have gone quiet
      // in the source file once its own part had nothing left to play.
      part.loopEnd = loopDuration !== undefined ? loopDuration : delay;
    },
    setAnimator: animator => {
      isPlayingAnimator = animator;
    },
    setNoteIndexModifier: val => {
      noteIndexModifier = val;
    },
    setFirstNoteIndex: val => {
      firstNoteIndex = val;
    },
    setScaleObj: val => {
      scaleObj = val;
    },
    setIsMuted: val => {
      isMuted = val;
      part.mute = val;
      applySf2Volume();
    },
    setIsSoloed: val => {
      isSoloed = val;
      if (solo) solo.solo = val;
      applySf2Volume();
    },
    // built-in colors rely on Tone.Solo's own global coordination to know
    // when some OTHER shape is soloed (confirmed earlier this session -
    // every Tone.Solo instance checks all the others); SF2 channels have
    // no such instance to participate in that, so they need to be told
    // explicitly
    setIsAnyShapeSoloed: val => {
      isAnyShapeSoloed = val;
      applySf2Volume();
    },
    setTempo: tempo => {
      part.playbackRate = tempo / 50;
    },
    setPan: val => {
      panVal = val;
      if (isSf2) {
        applySf2Pan();
      } else if (panner) {
        panner.pan.value = val * 0.9;
      }
    },
    setPan3d: _avgPt => {
      avgPt = _avgPt;
      if (!isSf2 && panner3d) {
        panner3d.positionX = avgPt.x;
        panner3d.positionY = avgPt.y;
      }
    },
    setProximityMode: _isProximityMode => {
      isProximityMode = _isProximityMode;
      if (isSf2 || !synth) return;
      if (isProximityMode) {
        pannerNode = panner3d;
      } else {
        pannerNode = panner;
      }
      synth.disconnect();
      synth.chain(pannerNode, solo, gain);
    },
    setProximityRadius: _proximityRadius => {
      proximityRadius = _proximityRadius;
      if (panner3d) panner3d.set('maxDistance', proximityRadius);
    },
    // Seconds of silence before this shape's loop begins for the very
    // first time - lets a MIDI import reproduce "this instrument doesn't
    // enter until 8 bars in" instead of every imported shape starting the
    // instant Play is pressed. part.start(0) only takes effect once
    // (Tone.Event.start is a no-op if the Part's state already says
    // Started at that time, which it does immediately after construction)
    // - cancel() first so a changed offset actually reschedules it, same
    // as every other live-editable control here.
    setStartOffset: seconds => {
      const val = seconds || 0;
      if (val === startOffset) return;
      startOffset = val;
      part.cancel(0);
      part.start(startOffset);
    },
    // How long this shape's own loop takes, start to wraparound, in real
    // seconds - its own startOffset (silence before the loop first
    // begins) plus one full loop period (part.loopEnd, raw units,
    // converted via the current playbackRate). PlayBar uses the longest
    // of these across every shape as its own total "track length" -
    // there's no other fixed song duration to show progress against,
    // since every shape loops independently and can be a totally
    // different length (that's deliberate - see utils/midiImport.js's
    // commonLoopDuration comment for why MIDI-imported shapes share one,
    // but hand-drawn shapes never do).
    getLoopDurationSeconds: () => {
      if (!(part.loopEnd > 0)) return 0;
      return startOffset + part.loopEnd / part.playbackRate;
    },
    // PlayBar's scrub preview - given a point on the GLOBAL transport
    // timeline (real seconds since Transport started, i.e. Tone.Transport.
    // seconds), works out which note this shape would be sounding right
    // then, without touching audio at all. Mirrors the Part callback's own
    // math (Synth.js's main callback above) in reverse: real seconds ->
    // raw units via playbackRate, wrapped into this shape's own loop
    // period, then a linear scan of `schedule` (same data every part.add()
    // call above already built) for the note whose [delay, delay+duration)
    // span contains that position. Returns null if the shape hasn't
    // entered yet at this transport time (time < startOffset) - nothing to
    // show for a shape that's still silent at this point in the piece.
    getNoteAtTransportTime: transportSeconds => {
      if (!schedule.length) return null;
      const elapsedSeconds = transportSeconds - startOffset;
      if (elapsedSeconds < 0) return null;

      const loopPeriodSeconds = part.loopEnd / part.playbackRate;
      if (!(loopPeriodSeconds > 0)) return null;
      const elapsedInLoopSeconds = elapsedSeconds % loopPeriodSeconds;
      const elapsedInLoopRaw = elapsedInLoopSeconds * part.playbackRate;

      for (let i = 0; i < schedule.length; i++) {
        const ev = schedule[i];
        if (elapsedInLoopRaw >= ev.delay && elapsedInLoopRaw < ev.delay + ev.duration) {
          return ev;
        }
      }
      // floating-point edge case right at the loop boundary - treat as
      // "about to wrap back to the first note"
      return schedule[0];
    },
    dispose: () => {
      part.dispose();
      if (synth) disposeSynth();
    },
  };
}
