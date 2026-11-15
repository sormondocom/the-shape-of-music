import React from 'react';
import ErrorBoundary from 'components/ErrorBoundary';
import Routes from './Routes';
import { ColorThemeContextProvider } from 'context/ColorThemeContext/ColorThemeContextProvider';

function App() {
  return (
    <ErrorBoundary>
      <ColorThemeContextProvider>
        <Routes />
      </ColorThemeContextProvider>
    </ErrorBoundary>
  );
}

export default App;
