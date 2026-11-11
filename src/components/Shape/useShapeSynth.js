import { useRef, useState, useEffect, useContext } from 'react';
import { ProjectContext } from 'components/Project/ProjectContextProvider';
import { isSustainedInstrument } from 'utils/synths';
import { setShapeDuration, removeShapeDuration } from 'utils/transportCursor';
import { Synth } from './Synth';

export const useShapeSynth = ({
  index,
  colorIndex,
  volume,
  isPlayingAnimator,
  points,
  noteEvents,
  noteIndexModifier,
  firstNoteIndex,
  isMuted,
  isSoloed,
  isAnyShapeSoloed,
  panVal,
  averagePoint,
  startOffset,
  loopDuration,
  isVisible,
  audioScale,
}) => {
  const {
    tempo,
    scaleObj,
    knobVals,
    selectedSynths,
    isProximityModeActive,
    proximityModeRadius,
  } = useContext(ProjectContext);
  const [isBuffering, setIsBuffering] = useState(false);
  const selectedSynth = selectedSynths[colorIndex];
  const shapeKnobVals = knobVals[colorIndex];
  const synthContainer = useRef(null);

  useEffect(() => {
    synthContainer.current = new Synth({
      onStartLoading: () => setIsBuffering(true),
      onEndLoading: () => setIsBuffering(false),
    });
    return () => {
      synthContainer.current.dispose();
      removeShapeDuration(index);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    synthContainer.current.setScaleObj(scaleObj);
  }, [scaleObj]);

  useEffect(() => {
    synthContainer.current.setTempo(tempo);
  }, [tempo]);

  useEffect(() => {
    synthContainer.current.setFirstNoteIndex(firstNoteIndex);
  }, [firstNoteIndex]);

  useEffect(() => {
    synthContainer.current.setSynth(selectedSynth, colorIndex);
  }, [selectedSynth, colorIndex]);

  useEffect(() => {
    synthContainer.current.setKnobValues(shapeKnobVals);
  }, [shapeKnobVals]);

  useEffect(() => {
    // an imported MIDI shape carries its own exact note data - play that
    // directly (bypassing scale-degree derivation) as long as it still lines
    // up 1:1 with the current vertex count; adding/deleting a vertex breaks
    // that alignment and falls back to the normal geometry-driven path
    if (noteEvents && noteEvents.length === points.length / 2) {
      synthContainer.current.setAbsoluteNoteEvents(noteEvents, points, loopDuration);
    } else {
      synthContainer.current.setNoteEvents(scaleObj, points, audioScale);
    }
  }, [scaleObj, points, noteEvents, loopDuration, audioScale]);

  useEffect(() => {
    synthContainer.current.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    synthContainer.current.setStartOffset(startOffset);
  }, [startOffset]);

  useEffect(() => {
    synthContainer.current.setAnimator(isPlayingAnimator);
  }, [isPlayingAnimator]);

  useEffect(() => {
    synthContainer.current.setNoteIndexModifier(noteIndexModifier);
  }, [noteIndexModifier]);

  useEffect(() => {
    // Hidden (LayersPanel's visibility toggle) always means silent, on top
    // of whatever the ordinary Mute button already says - a separate
    // concept from Mute (visibility also hides the shape on canvas), but
    // the same audio effect, so it's simplest to just OR the two into the
    // one mute the Synth already knows about rather than teach it a second
    // reason to go quiet.
    synthContainer.current.setIsMuted(isMuted || !isVisible);
  }, [isMuted, isVisible]);

  useEffect(() => {
    synthContainer.current.setIsSoloed(isSoloed);
  }, [isSoloed]);

  useEffect(() => {
    // SF2-backed colors have no Tone.Solo instance to participate in its
    // own global "is anything else soloed" coordination - see Synth.js
    synthContainer.current.setIsAnyShapeSoloed(isAnyShapeSoloed);
  }, [isAnyShapeSoloed]);

  useEffect(() => {
    synthContainer.current.setPan(panVal);
  }, [panVal]);

  useEffect(() => {
    if (averagePoint) {
      synthContainer.current.setPan3d(averagePoint);
    }
  }, [averagePoint]);

  useEffect(() => {
    synthContainer.current.setProximityRadius(proximityModeRadius);
  }, [proximityModeRadius]);

  useEffect(() => {
    synthContainer.current.setProximityMode(isProximityModeActive);
  }, [isProximityModeActive]);

  useEffect(() => {
    // Runs after the effects above that actually set note content/
    // startOffset/tempo on the synth this render, so getLoopDurationSeconds
    // reflects this commit's values, not last render's stale ones -
    // PlayBar's own "track length" is just the longest of these across
    // every shape (utils/transportCursor.js).
    setShapeDuration(index, synthContainer.current.getLoopDurationSeconds());
  }, [index, points, noteEvents, loopDuration, startOffset, tempo]);

  return {
    isBuffering,
    isSustained: isSustainedInstrument(selectedSynth),
    getNoteAtTransportTime: t => synthContainer.current.getNoteAtTransportTime(t),
  };
};
