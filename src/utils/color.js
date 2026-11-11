import Color from 'color';

export const THEMES = { LIGHT: 'light', DARK: 'dark' };

// First 5 are unchanged (existing saved projects reference colorIndex 0-4
// directly) - 11 more added after, spaced around the color wheel for
// visual distinctness, to support up to 16 simultaneous instrument slots.
export const themeColors = [
  '#c9563c', // red
  '#e8a531', // yellow
  '#2a548e', // blue
  '#705498', // purple
  '#33936b', // green
  '#c94f8e', // pink
  '#4fb8c9', // cyan
  '#8e6b3c', // brown
  '#5c7a29', // olive
  '#b53c3c', // dark red
  '#3c8fc9', // sky blue
  '#9d4fc9', // violet
  '#c98f3c', // orange
  '#3ca68f', // teal
  '#7a7a7a', // gray
  '#c9c13c', // mustard
];

export const appColors = {
  black: '#242424',
  white: '#fff',
  grayLightest: '#f1f1f1',
  grayLight: '#eee',
  grayMedium: '#ddd',
  grayDark: '#999',
  red: 'red',
};

export const getDarker = (color, amount = 0.1) =>
  Color(color)
    .darken(amount)
    .toString();

export const getLighter = (color, amount = 0.1) =>
  Color(color)
    .lighten(amount)
    .toString();
