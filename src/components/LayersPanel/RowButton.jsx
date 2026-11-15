import React from 'react';
import PropTypes from 'prop-types';
import cx from 'classnames';

import styles from './styles.module.css';

const propTypes = {
  title: PropTypes.string.isRequired,
  isActive: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

/*
  One of a LayerRow's right-side action buttons (visibility, mute, solo,
  delete, sheet-preview, ...) - every one of these across every row type
  (shape, reference image, reference geo layer) was the same "stop the
  click from also selecting the row, show a title, toggle an active
  look" shape; this is that, once.
*/
function RowButton({ title, isActive, onClick, children }) {
  return (
    <button
      className={cx(styles.rowButton, { [styles.rowButtonActive]: isActive })}
      title={title}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

RowButton.propTypes = propTypes;

export default RowButton;
