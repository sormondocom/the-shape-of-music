import React from 'react';
import PropTypes from 'prop-types';
import { Circle } from 'react-konva';
import { appColors } from 'utils/color';
import { useProjectContext } from 'context/useProjectContext';

const propTypes = {
  gridSize: PropTypes.number.isRequired,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
};

function Grid(props) {
  const { stageScale } = useProjectContext();
  const { width, height, gridSize } = props;
  const gridDots = [];
  const color = appColors.grayDark;
  // counter-scale against zoom, same reasoning as every other handle this
  // session - the grid SPACING is deliberately content-space (cells take
  // up more screen room as you zoom in, same as any grid), but the DOT
  // SIZE shouldn't balloon along with it
  const radius = 1 / stageScale;
  if (!width) {
    return null;
  }

  for (let x = gridSize; x < width; x += gridSize) {
    for (let y = gridSize; y < height; y += gridSize) {
      const gridDot = (
        <Circle key={'dot' + x + y} x={x} y={y} radius={radius} fill={color} />
      );
      gridDots.push(gridDot);
    }
  }
  return gridDots;
}

Grid.propTypes = propTypes;

export default Grid;
