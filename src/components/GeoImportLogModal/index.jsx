import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Portal from 'react-portal';
import {
  CheckCircleFilled,
  CheckOutlined,
  ExclamationCircleFilled,
  LoadingOutlined,
  WarningFilled,
} from '@ant-design/icons';

import Button from 'components/Button';
import { appColors } from 'utils/color';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import styles from './styles.module.css';

const propTypes = {
  sourceLabel: PropTypes.string.isRequired,
  entries: PropTypes.arrayOf(
    PropTypes.shape({
      text: PropTypes.string.isRequired,
      type: PropTypes.oneOf(['info', 'warning', 'success', 'error']),
    })
  ).isRequired,
  status: PropTypes.oneOf(['running', 'done', 'error']).isRequired,
  onConfirm: PropTypes.func.isRequired,
};

const ENTRY_ICONS = {
  warning: <WarningFilled style={{ color: '#d48806' }} />,
  success: <CheckCircleFilled style={{ color: '#52c41a' }} />,
  error: <ExclamationCircleFilled style={{ color: '#f5222d' }} />,
};

/*
  Shown for the duration of a geo import (GPX/KML/GeoJSON/Shapefile -
  Toolbar's handleGeoFileChange) and left up afterward as a detailed,
  readable record of what happened (features found, skipped, capped,
  imported) - replacing a single toast that said only "Imported N shapes"
  and vanished a few seconds later with no way to see it again.

  No backdrop-click-to-dismiss on purpose: the whole point is an explicit
  acknowledgement (the OK button) before the user starts clicking/dragging
  the shapes this same click could otherwise land on accidentally the
  instant they're placed.
*/
function GeoImportLogModal({ sourceLabel, entries, status, onConfirm }) {
  const { isDarkMode } = useColorThemeContext();
  const bodyRef = useRef();
  const isRunning = status === 'running';

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <Portal isOpened>
      <div className={styles.backdrop} />
      <div
        className={styles.panel}
        style={{
          background: isDarkMode ? '#2b2b2b' : '#fff',
          color: isDarkMode ? '#eee' : appColors.black,
        }}
      >
        <div className={styles.header}>
          {isRunning && <LoadingOutlined />}
          {status === 'error' && <ExclamationCircleFilled style={{ color: '#f5222d' }} />}
          {status === 'done' && <CheckCircleFilled style={{ color: '#52c41a' }} />}
          <span>Importing {sourceLabel}</span>
        </div>
        <div className={styles.body} ref={bodyRef}>
          {entries.map((entry, i) => (
            <div key={i} className={styles.entry}>
              <span className={styles.entryIcon}>{ENTRY_ICONS[entry.type]}</span>
              <span>{entry.text}</span>
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          <Button color={appColors.black} hasBorder disabled={isRunning} onClick={onConfirm}>
            <span className={styles.okLabel}>
              <CheckOutlined /> OK
            </span>
          </Button>
        </div>
      </div>
    </Portal>
  );
}

GeoImportLogModal.propTypes = propTypes;

export default GeoImportLogModal;
