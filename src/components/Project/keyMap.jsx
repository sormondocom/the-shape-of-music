export const keyMap = {
  PLAY: 'space',
  TOGGLE_ACTIVE_TOOL: 'tab',
  // digits 1-9 pick colorIndex 0-8 (16 slots exist in total now - slots
  // 9-16 have no keyboard shortcut, deliberately: 1-9 covers every single
  // digit key, and WASD/Z/Q are already claimed for pan/zoom, so a
  // modifier-chord scheme for the rest isn't worth the complexity. Pick
  // those via the swatch UI (Toolbar/ColorSelect.jsx, LayersPanel, etc.)
  CHANGE_DRAW_COLOR: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  ALT_DOWN: [{ sequence: 'alt', action: 'keydown' }],
  ALT_UP: [{ sequence: 'alt', action: 'keyup' }],
  DELETE_SHAPE: 'backspace',
  CANCEL_IN_PROGRESS_SHAPE: 'escape',
  // Pan (arrows/WASD) and zoom (Z/Q) are NOT handled here - react-hotkeys
  // defaults to ignoreRepeatedEventsWhenKeyHeldDown (Configuration.js) and
  // is generally built around discrete hotkey actions, not held-key state
  // tracking; that caused a visible debounce-like glitch on direction
  // changes. They're wired directly via native keydown/keyup listeners in
  // Project/index.jsx instead - see the continuous-pan/zoom comment there.
};
