import JSZip from 'jszip';
import { saveAs } from 'file-saver';
const MidiWriter = require('midi-writer-js');

/*
  Prefers a real native "Save As" dialog (File System Access API, Chromium
  only) so the user picks the destination/filename directly; falls back to
  the standard file-saver download (today's behavior) everywhere else, or
  if the user's browser throws for a reason other than cancelling.

  `mimeType` (optional) lets the native picker enforce/auto-append the right
  extension - without a `types` filter, showSaveFilePicker has no idea what
  extension to add if the user types a name without one, so the saved file
  can silently end up extensionless.
*/
export const saveFileAs = async (blob, suggestedName, mimeType) => {
  if (window.showSaveFilePicker) {
    try {
      const extensionMatch = suggestedName.match(/\.[^./\\]+$/);
      const extension = extensionMatch ? extensionMatch[0] : '';
      const pickerOptions = { suggestedName };
      if (mimeType && extension) {
        pickerOptions.types = [
          {
            description: `${extension.slice(1).toUpperCase()} file`,
            accept: { [mimeType]: [extension] },
          },
        ];
      }
      const handle = await window.showSaveFilePicker(pickerOptions);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled - don't fall back
    }
  }
  saveAs(blob, suggestedName);
};

export const readFileAsDataURL = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const readFileAsText = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });

// The app's own project format - "GeoBoard" (this project's earlier name
// for what later became the geographic-canvas feature; "a musical
// geoboard" per the README's own opening line). Just JSON under a
// distinct extension, same idea as a lot of app-specific formats (.ipynb,
// for instance) - deliberately NOT .json, so saving/opening a project
// never looks like (or risks literally becoming) saving over whatever
// file you originally imported from (a .mid, a .shp) - this is always
// its own separate file, in this app's own format, regardless of what
// the project started from.
export const GEOB_EXTENSION = '.geob';
const GEOB_MIME_TYPE = 'application/geob+json';
// Bumped only if a future change to what getProjectSaveData (utils/
// project.js) produces would break reading an OLDER .geob file as-is -
// readGeobFile can use this to decide whether/how to migrate, rather than
// guessing from field presence alone.
const GEOB_FORMAT_VERSION = 1;

export const saveProjectAsGeob = async projectSaveData => {
  const payload = { geobFormatVersion: GEOB_FORMAT_VERSION, ...projectSaveData };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: GEOB_MIME_TYPE,
  });
  const suggestedName = `${projectSaveData.name || 'Untitled Project'}${GEOB_EXTENSION}`;
  await saveFileAs(blob, suggestedName, GEOB_MIME_TYPE);
};

// The Open counterpart - deliberately light validation (just "is this
// even a plausible project save, not literal garbage"), not a full schema
// check: utils/project.js's getInitState already tolerates a project
// missing most individual fields (same code path a cloud-loaded project
// without every field goes through), so there's nothing extra to enforce
// here beyond "this parses as JSON and has a shapesList array".
export const readGeobFile = async file => {
  const text = await readFileAsText(file);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('Not a valid .geob file (not JSON)');
  }
  if (!data || !Array.isArray(data.shapesList)) {
    throw new Error('Not a valid .geob file (missing shapesList)');
  }
  return data;
};

export const ZipFile = name => {
  const zip = new JSZip();
  const folder = zip.folder(name);

  return {
    add: (name, data) => {
      folder.file(`${name}`, data);
    },
    download: async () => {
      const content = await zip.generateAsync({ type: 'blob' });
      await saveFileAs(content, `${name}.zip`, 'application/zip');
    },
  };
};

export const convertAndDownloadTracksAsMIDI = async ({
  tempo,
  shapeNoteEventsList,
  projectName,
}) => {
  const zip = ZipFile(projectName || 'The Shape of Music Project');

  // create MIDI track for each shape
  shapeNoteEventsList.forEach((noteEvents, i) => {
    const track = new MidiWriter.Track();

    // TODO: confirm what the MIDI tempo should be
    track.setTempo(60);
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 }));
    track.addTrackName(`Shape ${i + 1}`);

    // TODO: confirm Tick duration calculation
    noteEvents.forEach(({ note, duration }) => {
      const midiNoteEvent = {
        pitch: [note],
        duration: `T${duration * 60 * (100 / tempo)}`,
      };
      const midiNote = new MidiWriter.NoteEvent(midiNoteEvent);
      track.addEvent(midiNote);
    });

    const write = new MidiWriter.Writer([track]);
    zip.add(`shape-${i + 1}.mid`, write.buildFile());
  });

  await zip.download();
};
