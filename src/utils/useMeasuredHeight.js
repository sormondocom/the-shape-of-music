import { useState, useEffect } from 'react';

/*
  Tracks a DOM element's real rendered height live via ResizeObserver,
  rather than hardcoding a number that has to be kept in sync by hand.

  Built for ColorControllerPanel's footer (#colorControllerPanel): its
  height is a fixed constant today (132px, in its own styles.module.css),
  but LayersPanel and Spectrometer measure it live instead of hardcoding
  a second comment-linked copy of that number, so they can't drift out of
  sync if it's ever changed again.
*/
export const useMeasuredHeight = elementId => {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = document.getElementById(elementId);
    if (!el) return undefined;

    const update = () => setHeight(el.getBoundingClientRect().height);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [elementId]);

  return height;
};
