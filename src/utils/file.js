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
