import React from 'react';
import PropTypes from 'prop-types';
import CustomSlider from 'components/Slider';
import { appColors, getDarker } from 'utils/color';
const { grayLightest } = appColors;
const lightGray = getDarker(grayLightest);

const propTypes = {
  onChange: PropTypes.func.isRequired,
  value: PropTypes.number.isRequired,
};

function TempoInput(props) {
  const { value, onChange } = props;
  return (
    <div
      style={{
        borderRadius: 3,
        overflow: 'hidden',
        border: `1px solid ${lightGray}`,
      }}
    >
      <CustomSlider
        min={5}
        max={100}
        color="#eee"
        vertical={false}
        defaultValue={value}
        onChange={onChange}
        label={
          // CustomSlider's onChange fires continuously while dragging (not
          // just on release), and that flows straight back into this
          // `value` prop via the dispatch -> context round-trip in
          // Toolbar/index.jsx - so this number tracks the slider live,
          // even though the slider's own handle position is uncontrolled
          // (defaultValue, not value) and manages itself internally.
          <div style={{ color: 'initial', lineHeight: 1.15 }}>
            <div>Tempo</div>
            <div style={{ fontSize: '0.75em', opacity: 0.85 }}>{value}</div>
          </div>
        }
      />
    </div>
  );
}

TempoInput.propTypes = propTypes;

export default TempoInput;
