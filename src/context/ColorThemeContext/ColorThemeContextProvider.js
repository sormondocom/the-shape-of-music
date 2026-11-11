import React, { createContext, useState, useEffect } from 'react';
import cx from 'classnames';
import { THEMES } from 'utils/color';

export const ColorThemeContext = createContext({
  theme: THEMES.LIGHT,
  setTheme: () => {},
});

const THEME_STORAGE_KEY = 'theme';

const getStoredTheme = () => {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === THEMES.DARK || stored === THEMES.LIGHT ? stored : THEMES.LIGHT;
};

export const ColorThemeContextProvider = ({ children }) => {
  const [theme, setTheme] = useState(getStoredTheme);
  const isDarkMode = theme === THEMES.DARK;

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    // main.css's `body` rule lives outside the React tree entirely - toggle
    // a class directly on the real body element so it can follow the theme
    document.body.classList.toggle('theme--dark', isDarkMode);
  }, [theme, isDarkMode]);

  return (
    <ColorThemeContext.Provider value={{ theme, setTheme, isDarkMode }}>
      <div className={cx({ 'theme--dark': isDarkMode })}>{children}</div>
    </ColorThemeContext.Provider>
  );
};
