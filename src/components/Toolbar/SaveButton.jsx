import React from 'react';
import { SaveOutlined } from '@ant-design/icons';

// No in-app name prompt or "overwrite?" confirmation any more - saveProject
// (Project/index.jsx) always goes through a real save dialog now (utils/
// file.js's saveFileAs prefers the native Save As picker), which already
// lets the user name/confirm the file themselves. Asking twice was also
// how this ever said "Overwrite X?" about a project named after whatever
// MIDI/shapefile it was imported from - implying saving could overwrite
// that original file, which it never did or will; a project only ever
// saves as its own separate .geob file.
function SaveButton(props) {
  const { onClick } = props;
  return (
    <SaveOutlined id="SaveButton" title="Save Project" onClick={onClick} />
  );
}

export default SaveButton;
