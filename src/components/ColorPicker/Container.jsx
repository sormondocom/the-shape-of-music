import React from 'react';
import { func, number, string, arrayOf } from 'prop-types';
import { GithubPicker } from 'react-color';
import { themeColors } from 'utils/color';
import withProjectContext from 'components/Project/withProjectContext';

const propTypes = {
  onChange: func.isRequired,
  activeColorIndex: number.isRequired,
  activeColorIndices: arrayOf(number).isRequired,
  color: string.isRequired,
  triangle: string,
};

function ColorPicker(props) {
  // only offer colors that actually have an instrument assigned - drawing
  // in one with no instrument would be silent (ColorControllerPanel is
  // where instruments get added/removed)
  const activeColors = props.activeColorIndices.map(i => themeColors[i]);
  return (
    <div>
      <GithubPicker
        style={{ borderRadius: 0 }}
        onChange={props.onChange}
        color={props.color}
        colors={activeColors}
        width="100%"
        triangle={props.triangle}
      />
    </div>
  );
}

ColorPicker.propTypes = propTypes;

export default withProjectContext(ColorPicker);
