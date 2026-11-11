import React from 'react';
import { Tooltip } from 'antd';
import { GlobalOutlined, SoundOutlined } from '@ant-design/icons';
import { useProjectContext } from 'context/useProjectContext';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { CANVAS_MODES, PROJECT_ACTIONS } from 'utils/project';
import { appColors } from 'utils/color';
import Color from 'color';
import styles from './styles.module.css';

/*
  Mirrors Sidebar's own left-edge tab strip (save/downloads/export), just
  on the opposite side - a small vertical strip of icon buttons right
  against LayersPanel's left edge, switching between the musical canvas
  (the default, always-existing one) and geographic mode (GPS-track
  import - utils/geoTrackImport.js - and, later, a georeferenced map
  reference layer).

  No literal harp icon exists in either icon set this app already uses
  (Ant Design icons, Ionicons) - SoundOutlined (a speaker) stands in for
  "musical" instead; swap it out here if a closer asset shows up later.
*/
function CanvasModeToggle() {
  const { canvasMode, dispatch } = useProjectContext();
  const { isDarkMode } = useColorThemeContext();

  const setMode = mode => dispatch({ type: PROJECT_ACTIONS.SET_CANVAS_MODE, payload: mode });

  return (
    <div className={styles.toggle}>
      <div
        className={styles.tabs}
        style={{
          color: isDarkMode && appColors.grayLightest,
          background: isDarkMode && Color(appColors.black).lighten(0.4),
        }}
      >
        <Tooltip placement="left" title="Musical canvas">
          <div
            className={styles.tabButton}
            style={{
              opacity: canvasMode === CANVAS_MODES.MUSICAL ? 1 : 0.5,
              color: canvasMode === CANVAS_MODES.MUSICAL ? '#00aaff' : undefined,
            }}
            onClick={() => setMode(CANVAS_MODES.MUSICAL)}
          >
            <SoundOutlined />
          </div>
        </Tooltip>
        <Tooltip
          placement="left"
          title="Geographic mode - OpenStreetMap base layer; import GPX/KML/GeoJSON/Shapefile as shapes"
        >
          <div
            className={styles.tabButton}
            style={{
              opacity: canvasMode === CANVAS_MODES.GEOGRAPHIC ? 1 : 0.5,
              color: canvasMode === CANVAS_MODES.GEOGRAPHIC ? '#00aaff' : undefined,
            }}
            onClick={() => setMode(CANVAS_MODES.GEOGRAPHIC)}
          >
            <GlobalOutlined />
          </div>
        </Tooltip>
      </div>
    </div>
  );
}

export default CanvasModeToggle;
