import React, { useContext, useEffect, useRef, useState } from 'react';
import { Circle } from 'react-konva';
import { dist, getMidpoint } from '../../utils/math';
import { MousePosContext, StagePosContext } from '../ShapeCanvas/Component';
import { useProjectContext } from 'context/useProjectContext';

/*
  Midpoint along a shape edge. Can be clicked on to create a new vertex
*/
function EdgeMidpoint(props) {
  const { p1, p2, color, handleMouseDown } = props;

  const ref = useRef(null);
  const mousePos = useContext(MousePosContext);
  const [isInRange, setIsInRange] = useState(false);
  const { stageScale } = useProjectContext();
  // stagePos comes from its own dedicated context (not the shared project
  // one) specifically so this is the only shape-level component that
  // re-renders on every pan frame - see StagePosContext's comment in
  // ShapeCanvas/Component.jsx
  const stagePos = useContext(StagePosContext);

  const pt = getMidpoint(p1.x, p1.y, p2.x, p2.y);

  useEffect(() => {
    let absPt = pt;
    if (ref.current) {
      // Konva's "absolute" position is in screen/stage pixel space
      // (includes the stage's own zoom/pan), while mousePos is
      // content-space - convert mousePos to the same screen-space before
      // comparing, so "within 160px" means 160 actual screen pixels
      // regardless of zoom (same constant-on-screen reasoning as the
      // handle-size counter-scaling below)
      absPt = ref.current.getAbsolutePosition();
    }
    const mousePosScreen = {
      x: mousePos.x * stageScale + stagePos.x,
      y: mousePos.y * stageScale + stagePos.y,
    };
    const isInRange = dist(absPt.x, absPt.y, mousePosScreen.x, mousePosScreen.y) < 160;
    setIsInRange(isInRange);
  }, [mousePos, pt, stageScale, stagePos]);

  const { x, y } = pt;
  // counter-scale against zoom, same reasoning as ShapeVertex.jsx
  const defaultRadius = 6 / stageScale;
  const hoverRadius = 8 / stageScale;
  const strokeWidth = 2 / stageScale;
  const [isHovered, setIsHovered] = useState(false);
  const radius = isHovered ? hoverRadius : defaultRadius;

  return (
    <>
      {/*<Text x={x + 10} y={y} text={`${absPt.x}, ${absPt.y}`} />*/}
      <Circle
        ref={ref}
        x={x}
        y={y}
        radius={radius}
        onMouseDown={handleMouseDown}
        stroke={color}
        strokeWidth={strokeWidth}
        opacity={isInRange ? 0.9 : 0}
        onMouseOver={() => {
          setIsHovered(true);
        }}
        onMouseOut={() => {
          setIsHovered(false);
        }}
      />
    </>
  );
}

export default EdgeMidpoint;
