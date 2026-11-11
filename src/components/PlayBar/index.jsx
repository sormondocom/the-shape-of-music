import React, { useRef, useEffect, useState, useCallback } from 'react';
import Tone from 'tone';
import { Tooltip } from 'antd';
import IconButton from 'components/IconButton';
import { useProjectContext } from 'context/useProjectContext';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { useMeasuredHeight } from 'utils/useMeasuredHeight';
import { getCanvasWidth } from 'utils/project';
import { appColors } from 'utils/color';
import {
  getMaxShapeDuration,
  subscribeToShapeDurations,
  publishTransportTime,
} from 'utils/transportCursor';
import styles from './styles.module.css';

const { red } = appColors;

const formatTime = seconds => {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/*
  A seekable progress bar for the whole canvas, sitting just above the
  Spectrometer. There's no single fixed "song length" here - every shape
  loops independently, often at a deliberately different length from
  every other one (that's the whole polyrhythm idea for hand-drawn
  shapes; utils/midiImport.js's commonLoopDuration is the one case where
  several shapes share a length, for MIDI-imported content) - so this
  bar's own total length is just the longest loop currently registered
  (utils/transportCursor.js's shape-duration registry, kept live by every
  shape's own Shape/useShapeSynth.js).

  Dragging the handle moves Tone.Transport.seconds directly - Tone.js's
  own supported way to seek. While paused, that also publishes the new
  position (utils/transportCursor.js's time channel) so every shape can
  show, via its own progress dot, which note it would start on from here
  (Shape/ContainerV2.jsx's subscribeToTransportTime effect) - while
  playing, the next real note trigger will reflect the new position on
  its own, so there's nothing extra to publish.
*/
function PlayBar() {
  const {
    isPlaying,
    isArmed,
    isRecording,
    imperativeHandlers: { togglePlayStop, stopPlayback, toggleRecord },
  } = useProjectContext();
  const { isDarkMode } = useColorThemeContext();
  const colorControllerPanelHeight = useMeasuredHeight('colorControllerPanel');
  const spectrometerHeight = useMeasuredHeight('spectrometerPanel');

  const trackRef = useRef();
  const fillRef = useRef();
  const handleRef = useRef();
  const timeLabelRef = useRef();
  const durationRef = useRef(getMaxShapeDuration());
  const [hasDuration, setHasDuration] = useState(durationRef.current > 0);
  const isDraggingRef = useRef(false);

  useEffect(
    () =>
      subscribeToShapeDurations(() => {
        durationRef.current = getMaxShapeDuration();
        setHasDuration(durationRef.current > 0);
      }),
    []
  );

  // imperative DOM updates (not React state) for the fill/handle/label -
  // these can tick every animation frame while playing, and routing that
  // through setState would re-render this component (and everything it
  // reads from context) 60 times a second for no visible benefit
  const renderFraction = useCallback((fraction, seconds) => {
    const pct = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (handleRef.current) handleRef.current.style.left = pct;
    if (timeLabelRef.current) {
      timeLabelRef.current.textContent =
        durationRef.current > 0
          ? `${formatTime(seconds)} / ${formatTime(durationRef.current)}`
          : 'No shapes yet';
    }
  }, []);

  const fractionAndSecondsAt = () => {
    const duration = durationRef.current;
    if (!(duration > 0)) return { fraction: 0, seconds: 0 };
    const seconds = Tone.Transport.seconds % duration;
    return { fraction: seconds / duration, seconds };
  };

  // live-advance while playing
  useEffect(() => {
    if (!isPlaying) return undefined;
    let rafId;
    const tick = () => {
      const { fraction, seconds } = fractionAndSecondsAt();
      renderFraction(fraction, seconds);
      rafId = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, renderFraction]);

  // snap to (and publish) the exact position the instant playback pauses,
  // so the bar and every shape's preview dot agree with where it actually
  // stopped rather than wherever the last animation frame left them
  useEffect(() => {
    if (isPlaying) return;
    const { fraction, seconds } = fractionAndSecondsAt();
    renderFraction(fraction, seconds);
    publishTransportTime(Tone.Transport.seconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  const seekToClientX = clientX => {
    const duration = durationRef.current;
    if (!(duration > 0) || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const seconds = fraction * duration;
    Tone.Transport.seconds = seconds;
    renderFraction(fraction, seconds);
    if (!isPlaying) publishTransportTime(seconds);
  };

  const handleMouseDown = e => {
    if (!hasDuration) return;
    isDraggingRef.current = true;
    seekToClientX(e.clientX);

    const handleMove = moveEvent => {
      if (isDraggingRef.current) seekToClientX(moveEvent.clientX);
    };
    const handleUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      id="playBarPanel"
      className={styles.panel}
      style={{
        width: getCanvasWidth(),
        bottom: colorControllerPanelHeight + spectrometerHeight,
        background: isDarkMode ? 'rgba(20,20,20,0.95)' : 'rgba(255,255,255,0.95)',
        color: isDarkMode ? '#eee' : undefined,
      }}
    >
      <div className={styles.transportButtons}>
        <Tooltip
          title={
            <span>
              {isPlaying ? 'Pause' : 'Play'}{' '}
              <span style={{ opacity: 0.6 }}>(SPACE)</span>
            </span>
          }
          placement="top"
        >
          <div>
            <IconButton
              iconClassName={isPlaying ? 'ion-pause' : 'ion-play'}
              onClick={togglePlayStop}
            />
          </div>
        </Tooltip>
        <Tooltip title="Stop (resets to the beginning)" placement="top">
          <div>
            <IconButton iconClassName="ion-stop" onClick={stopPlayback} />
          </div>
        </Tooltip>
        <Tooltip title="Record project to audio file" placement="top">
          <div
            className={isRecording ? styles.pulse : undefined}
            style={{ color: (isArmed || isRecording) && red }}
          >
            <IconButton iconClassName="ion-record" onClick={toggleRecord} />
          </div>
        </Tooltip>
      </div>
      <div
        ref={trackRef}
        className={styles.track}
        onMouseDown={handleMouseDown}
        style={{ cursor: hasDuration ? 'pointer' : 'default', opacity: hasDuration ? 1 : 0.4 }}
      >
        <div ref={fillRef} className={styles.fill} />
        <div ref={handleRef} className={styles.handle} />
      </div>
      <span ref={timeLabelRef} className={styles.timeLabel}>
        {hasDuration ? '0:00 / 0:00' : 'No shapes yet'}
      </span>
    </div>
  );
}

export default PlayBar;
