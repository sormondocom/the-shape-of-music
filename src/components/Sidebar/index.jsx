import React, { useRef, useState } from 'react';
import { Badge, Drawer, Tooltip, Dropdown, Menu } from 'antd';
import { DownloadOutlined, ExportOutlined, FolderOpenOutlined } from '@ant-design/icons';
import Downloads from 'components/Downloads';
import SaveButton from 'components/Toolbar/SaveButton';
import styles from './styles.module.css';
import { useProjectContext } from 'context/useProjectContext';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { appColors } from 'utils/color';
import { getSidebarTopOffset } from 'utils/project';
import Color from 'color';

function Sidebar(props) {
  const { showSaveButton } = props;

  const [seenDownloadCount, setSeenDownloadCount] = useState(0);
  const [isDownloadsDrawerVisible, setIsDownloadsDrawerVisible] = useState(
    false
  );

  const {
    downloadUrls,
    projectName,
    importedFileNames,
    imperativeHandlers: {
      exportProjectToMIDI,
      exportLineArt,
      exportToMp3,
      saveProject,
      openProject,
    },
  } = useProjectContext();

  const { isDarkMode } = useColorThemeContext();

  const openFileInputRef = useRef();

  const count = downloadUrls.length - seenDownloadCount;

  return (
    <div
      className={styles.sidebar}
      style={{ top: getSidebarTopOffset(importedFileNames.length) }}
    >
      <div
        className={styles.tabs}
        style={{
          color: isDarkMode && appColors.grayLightest,
          background: isDarkMode && Color(appColors.black).lighten(0.4),
        }}
      >
        {showSaveButton && (
          <>
            <Tooltip placement="right" title="Save Project (.geob)">
              <div className={styles.tabButton}>
                <SaveButton onClick={() => saveProject(projectName)} />
              </div>
            </Tooltip>
            <Tooltip placement="right" title="Open Project (.geob)">
              <div
                className={styles.tabButton}
                onClick={() => openFileInputRef.current.click()}
              >
                <FolderOpenOutlined />
              </div>
            </Tooltip>
            <input
              ref={openFileInputRef}
              type="file"
              accept=".geob"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files[0];
                e.target.value = '';
                if (file) openProject(file);
              }}
            />
          </>
        )}
        <Badge style={{ fontWeight: 'bold' }} count={count} offset={[-2, 2]}>
          <Tooltip placement="right" title="Downloads">
            <div
              className={styles.tabButton}
              style={{ color: isDarkMode && appColors.grayLightest }}
              onClick={() => {
                setSeenDownloadCount(downloadUrls.length);
                setIsDownloadsDrawerVisible(true);
              }}
            >
              <DownloadOutlined />
            </div>
          </Tooltip>
        </Badge>
        <Dropdown
          placement="bottomLeft"
          trigger={['click']}
          overlay={
            <Menu>
              <Menu.Item key="midi" onClick={exportProjectToMIDI}>
                Export MIDI
              </Menu.Item>
              <Menu.Item key="line-art" onClick={exportLineArt}>
                Export Line Art (SVG)
              </Menu.Item>
              <Menu.Item
                key="mp3"
                onClick={() => {
                  exportToMp3();
                  setIsDownloadsDrawerVisible(true);
                }}
              >
                Export MP3
              </Menu.Item>
            </Menu>
          }
        >
          <Tooltip placement="right" title="Export">
            <div className={styles.tabButton}>
              <ExportOutlined />
            </div>
          </Tooltip>
        </Dropdown>
      </div>
      <Drawer
        title="Downloads"
        placement="left"
        width={400}
        onClose={() => setIsDownloadsDrawerVisible(false)}
        visible={isDownloadsDrawerVisible}
        drawerStyle={{
          background: isDarkMode && appColors.black,
          color: isDarkMode && appColors.grayLightest,
        }}
        headerStyle={{
          borderColor: 'rgba(0,0,0,0.1)',
          background: isDarkMode && appColors.black,
          color: isDarkMode && appColors.grayLightest,
        }}
      >
        <Downloads downloadUrls={downloadUrls} />
      </Drawer>
    </div>
  );
}

export default Sidebar;
