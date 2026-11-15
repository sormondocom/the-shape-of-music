import React from 'react';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { useProjectContext } from 'context/useProjectContext';
import { appColors } from 'utils/color';
import styles from './styles.module.css';

/*
  A small, always-on label for "what am I currently working on" - sits
  between the toolbar and the Sidebar's save/export tabs, left-aligned.

  Two distinct things live here, deliberately styled apart:
  - projectName: this app's own .geob project name (or "Untitled
    Project") - the thing Save/Open actually read and write.
  - importedFileNames: the source file(s) (MIDI, geo tracks) the current
    canvas was built from - never the same thing as the project name (see
    utils/project.js's ADD_IMPORTED_FILE_NAME/SET_IMPORTED_FILE_NAMES),
    shown indented underneath in a clearly different (smaller, italic,
    monospace) style so the two are never mistaken for each other.

  Sidebar's own top offset (utils/project.js's getSidebarTopOffset) grows
  with importedFileNames.length to stay below however tall this renders.
*/
function FileNameBadge() {
  const { projectName, importedFileNames } = useProjectContext();
  const { isDarkMode } = useColorThemeContext();

  return (
    <div
      className={styles.badge}
      style={{
        color: isDarkMode ? appColors.grayLightest : undefined,
        background: isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)',
      }}
    >
      <div className={styles.projectName} title={projectName || 'Untitled Project'}>
        {projectName || 'Untitled Project'}
      </div>
      {importedFileNames.length > 0 && (
        <div className={styles.importedFiles}>
          {importedFileNames.map((fileName, i) => (
            <div key={`${fileName}-${i}`} className={styles.importedFile} title={fileName}>
              {fileName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FileNameBadge;
