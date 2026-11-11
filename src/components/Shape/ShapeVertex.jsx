import React, { useState } from 'react';
import Color from 'color';
import { /* useStrictMode, */ Circle } from 'react-konva';
import { useProjectContext } from 'context/useProjectContext';
// useStrictMode(true);

/*
  The shape's vertexes. Can be dragged to edit the shape.
*/
function ShapeVertex(props) {
  const {
    p,
    index,
    color,
    dragBoundFunc,
    handleVertexDelete,
    handleVertexDragMove,
  } = props;
  const { stageScale } = useProjectContext();
  const luminosity = Color(color).luminosity();
  const lightenAmount = 1.8 * (1 - luminosity);
  // counter-scale against the canvas zoom so handles stay a constant size
  // on screen - otherwise they'd balloon up right along with vertex spacing
  // on zoom, which doesn't actually make a dense cluster any more legible
  const defaultRadius = 6 / stageScale;
  const hoverRadius = 8 / stageScale;
  const strokeWidth = 2 / stageScale;
  // track hover as a flag rather than caching the computed radius itself -
  // otherwise zooming while not hovering would leave a stale, un-rescaled
  // radius until the next mouseover/mouseout
  const [isHovered, setIsHovered] = useState(false);
  const radius = isHovered ? hoverRadius : defaultRadius;

  // solid if first node, pale fill if not
  const fillColor =
    index === 0
      ? color
      : Color(color)
          .lighten(lightenAmount)
          .toString();

  return (
    <>
      {/*<Text x={p.x + 10} y={p.y} text={index} />*/}
      <Circle
        x={p.x}
        y={p.y}
        radius={radius}
        fill={fillColor}
        stroke={color}
        strokeWidth={strokeWidth}
        draggable
        // onMouseMove={() => console.log('vertex mouse move')}
        dragBoundFunc={dragBoundFunc}
        onDragMove={handleVertexDragMove}
        onMouseOver={() => setIsHovered(true)}
        onMouseOut={() => setIsHovered(false)}
        onDblClick={handleVertexDelete}
      />
    </>
  );
}

export default ShapeVertex;
