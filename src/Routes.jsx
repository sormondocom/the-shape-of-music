import React from 'react';
import { BrowserRouter, Route, Switch } from 'react-router-dom';
import ProjectCreate from 'views/ProjectCreate';
import NotFound from 'views/NotFound';
import PageWrapper from 'components/PageWrapper';
import Tutorial from 'views/Tutorial';

// Everything is local now (no account, no cloud project storage - see
// Project/index.jsx's saveProject/openProject, a .geob file through a
// real save dialog) - there's only ever one "project" screen, and it's
// never tied to an id, a login, or a backend of any kind.
export const ROUTES = {
  INDEX: '/',
  TUTORIAL: '/tutorial',
};

function Routes() {
  return (
    <BrowserRouter>
      <PageWrapper>
        <Switch>
          <Route
            exact
            path={ROUTES.INDEX}
            component={() => <ProjectCreate />}
          />
          <Route path={ROUTES.TUTORIAL} component={Tutorial} />
          <Route component={NotFound} />
        </Switch>
      </PageWrapper>
    </BrowserRouter>
  );
}

export default Routes;
