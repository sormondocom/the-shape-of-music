import React, { useEffect, useRef } from 'react';
import Tone from 'tone';

import { getCanvasWidth } from 'utils/project';
import { appColors } from 'utils/color';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { useMeasuredHeight } from 'utils/useMeasuredHeight';
import styles from './styles.module.css';

const CANVAS_HEIGHT = 80;
const FFT_SIZE = 128;
const MIN_DB = -100;
const MAX_DB = -30;

// classic spectrum-analyzer gradient: cool/quiet at the bottom rising
// through multiple hues to hot/peak at the top - deliberately multi-color,
// not a single-hue magnitude ramp, to read as a "real" spectrometer
const GRADIENT_STOPS = [
  [0, '#0a84ff'],
  [0.35, '#00d4c8'],
  [0.6, '#6be35a'],
  [0.8, '#ffd93d'],
  [1, '#ff3d5a'],
];

/*
  Live frequency spectrum of the master output. Self-contained: taps
  Tone.Master directly (same node src/components/Project/useRecorder.jsx
  already taps for WAV capture - connect() is a non-destructive fan-out),
  so it needs no props and no coordination with the synth/record code.
  Soloing a layer (ShapeCanvas/Container.jsx's soloedShapeIndices) already
  gates what's audible on this same master bus, so the spectrum naturally
  reflects just the soloed layer(s) with zero extra wiring here.
*/
function Spectrometer() {
  const canvasRef = useRef();
  const { isDarkMode } = useColorThemeContext();
  const isDarkModeRef = useRef(isDarkMode);
  isDarkModeRef.current = isDarkMode;
  const colorControllerPanelHeight = useMeasuredHeight('colorControllerPanel');

  useEffect(() => {
    const analyser = new Tone.Analyser({ type: 'fft', size: FFT_SIZE });
    Tone.Master.connect(analyser);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = getCanvasWidth();
    const height = CANVAS_HEIGHT;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // one gradient spanning the full height - each bar reveals progressively
    // more of it as it grows taller, so intensity reads as color, not just height
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    GRADIENT_STOPS.forEach(([stop, color]) => gradient.addColorStop(stop, color));

    const barGap = 1;
    const barCount = analyser.size;
    const barWidth = width / barCount - barGap;

    let rafId;
    const draw = () => {
      const values = analyser.getValue();
      const bg = isDarkModeRef.current ? appColors.black : appColors.grayLight;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = gradient;
      for (let i = 0; i < barCount; i++) {
        const normalized = Math.max(
          0,
          Math.min(1, (values[i] - MIN_DB) / (MAX_DB - MIN_DB))
        );
        const barHeight = normalized * height;
        const x = i * (barWidth + barGap);
        const y = height - barHeight;

        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [3, 3, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      }

      rafId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(rafId);
      Tone.Master.disconnect(analyser);
      analyser.dispose();
    };
  }, []);

  return (
    <div
      id="spectrometerPanel"
      className={styles.panel}
      style={{ width: getCanvasWidth(), bottom: colorControllerPanelHeight }}
    >
      <div className={styles.header}>Spectrometer</div>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ width: getCanvasWidth(), height: CANVAS_HEIGHT }}
      />
    </div>
  );
}

export default Spectrometer;
