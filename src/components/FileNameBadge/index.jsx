import React from 'react';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';
import { useProjectContext } from 'context/useProjectContext';
import { appColors } from 'utils/color';
import styles from './styles.module.css';

/*
  A small, always-on label for "what am I currently working on" - sits
  between the toolbar and the Sidebar's save/export tabs, left-aligned.

  Before this, the only place a project's name showed up at all
  (Project/index.jsx's top-center ProjectTitle) only rendered when BOTH a
  projectAuthor AND a projectName existed - i.e. a saved, attributed
  project. Two common states had nothing on screen naming the work at
  all: a freshly imported MIDI file (which now sets projectName to the
  file's own name - see Toolbar's handleMidiFileChange - but that name
  had nowhere to actually show up), and a brand new, never-saved project
  (no name at all). This always renders, falling back to "Untitled
  Project" in that second case, so there's never a moment where it's
  unclear what's currently open.
*/
function FileNameBadge() {
  const { projectName } = useProjectContext();
  const { isDarkMode } = useColorThemeContext();

  return (
    <div
      className={styles.badge}
      title={projectName || 'Untitled Project'}
      style={{
        color: isDarkMode ? appColors.grayLightest : undefined,
        background: isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)',
      }}
    >
      {projectName || 'Untitled Project'}
    </div>
  );
}

export default FileNameBadge;
