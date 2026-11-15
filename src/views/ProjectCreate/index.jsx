import React, { useState } from 'react';

import { DEFAULT_PROJECT } from 'utils/project';
import ProjectContainer from 'components/Project';

/*
  The app's one and only screen - everything is local (Project/index.jsx's
  saveProject/openProject, a .geob file through a real save dialog, utils/
  file.js), so there's no account, no project id, no backend of any kind
  to route between. This view's only real job is owning what gets handed
  to ProjectContainer as its initState: either a brand new project, or
  whatever an opened .geob file turned out to contain.

  remountKey forces a fresh ProjectContainer (and so a fresh ShapeCanvas
  mount, which is what actually seeds shapesList - Project/index.jsx's
  initShapesList prop only takes effect on mount) every time a different
  .geob file gets opened, rather than trying to hot-swap tempo/scale/grid/
  shapes/etc. into an already-running instance piecemeal.
*/
function ProjectCreate() {
  const [loadedProjectData, setLoadedProjectData] = useState(null);
  const [remountKey, setRemountKey] = useState(0);

  const handleOpenProject = data => {
    setLoadedProjectData(data);
    setRemountKey(key => key + 1);
  };

  const projectProps = {
    initState: loadedProjectData
      ? { ...DEFAULT_PROJECT, ...loadedProjectData, projectName: loadedProjectData.name }
      : DEFAULT_PROJECT,
    onOpenProject: handleOpenProject,
    showSaveButton: true,
  };

  return <ProjectContainer key={remountKey} {...projectProps} />;
}

export default ProjectCreate;
