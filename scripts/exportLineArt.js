#!/usr/bin/env node
/*
  Batch-converts MIDI files into "line art" SVGs - the same shape-outline
  export the app itself offers under the Export menu's "Export Line Art
  (SVG)" button. Point it at a single .mid/.midi file or a directory
  (searched recursively), and it writes one SVG per usable file to an
  output folder.

  Built for mass comparison: generate line art for a large batch of songs
  at once, then compare the resulting shapes across them for structural
  commonalities (similar melodic contours, similar accompaniment shapes,
  etc).

  Reuses the real app logic (utils/midiImport.js's MIDI->shape conversion,
  utils/svgExport.js's SVG builder) rather than reimplementing it - a
  CLI-generated SVG and the in-app export always agree, and any future
  improvement to either path applies to both.

  Usage:
    node scripts/exportLineArt.js <input> [options]
    yarn line-art <input> [options]

  <input>            A .mid/.midi file, or a directory to search (recursively)

  Options:
    --out <dir>       Output directory (default: ./line-art-output)
    --tonic <note>    Project tonic for pitch->shape mapping (default: a)
    --scale <name>    Project scale name, teoria-compatible (default: major)
    --help, -h        Show this message

  Examples:
    node scripts/exportLineArt.js song.mid
    node scripts/exportLineArt.js ./my-midi-collection --out ./shapes
    node scripts/exportLineArt.js ./songs --tonic c --scale minor
*/

const path = require('path');
const Module = require('module');

// Makes utils/* importable the same way the app's own webpack config
// resolves them (an absolute path from src/) - plain Node's CommonJS
// resolver already respects NODE_PATH for exactly this, it just only
// reads process.env.NODE_PATH once at boot, so setting it after startup
// needs an explicit Module._initPaths() to actually take effect.
process.env.NODE_PATH = [process.env.NODE_PATH, path.join(__dirname, '../src')]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();

// Transpiles the handful of utils/*.js files this script needs (plain ES
// modules, no JSX) into CommonJS on the fly - restricted to src/utils so
// nothing else (node_modules, the rest of the app) gets pulled through
// Babel by accident. This config is inline, not a project-root
// babel.config.js/.babelrc, so it has zero effect on the React app's own
// build.
require('@babel/register')({
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  babelrc: false,
  configFile: false,
  only: [/[\\/]src[\\/]utils[\\/]/],
});

const fs = require('fs');
const { Midi } = require('@tonejs/midi');
const Teoria = require('teoria');
const { convertMidiTrackToPoints, assignMidiImportChannels } = require('utils/midiImport');
const { buildLineArtSVG } = require('utils/svgExport');

const HELP_TEXT = `
Usage:
  node scripts/exportLineArt.js <input> [options]

<input>            A .mid/.midi file, or a directory to search (recursively)

Options:
  --out <dir>       Output directory (default: ./line-art-output)
  --tonic <note>    Project tonic (default: a)
  --scale <name>    Project scale, teoria-compatible (default: major)
  --help, -h        Show this message
`;

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(HELP_TEXT);
  process.exit(args.length === 0 ? 1 : 0);
}

const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const inputPath = args[0];
const outDir = getFlag('--out', './line-art-output');
const tonic = getFlag('--tonic', 'a');
const scaleName = getFlag('--scale', 'major');

let scaleObj;
try {
  scaleObj = Teoria.note(tonic).scale(scaleName);
} catch (err) {
  console.error(`Could not build a "${tonic} ${scaleName}" scale: ${err.message}`);
  process.exit(1);
}

const findMidiFiles = startPath => {
  const stat = fs.statSync(startPath);
  if (stat.isFile()) return [startPath];

  const results = [];
  const walk = dir => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.midi?$/i.test(entry.name)) {
        results.push(fullPath);
      }
    });
  };
  walk(startPath);
  return results;
};

// Mirrors Toolbar/index.jsx's handleMidiFileChange: same track filter
// (skip channel 9/percussion and empty tracks), same per-track geometry
// conversion, same per-track channel/color assignment so multiple tracks
// sharing a GM program get the same color consistently across the file -
// just without anything audio/React-specific, since this only needs the
// picture.
const convertFileToShapesList = filePath => {
  const buffer = fs.readFileSync(filePath);
  const midi = new Midi(buffer);

  const results = midi.tracks
    .filter(track => track.channel !== 9 && track.notes.length)
    .map(track => {
      const converted = convertMidiTrackToPoints({ notes: track.notes, scaleObj });
      if (!converted) return null;
      return { ...converted, program: track.instrument.number };
    })
    .filter(Boolean);

  if (!results.length) return null;

  const { colorIndexForTrack } = assignMidiImportChannels({
    programs: results.map(result => result.program),
    activeColorIndices: [],
    selectedSynths: [],
  });

  return results.map((result, i) => ({
    points: result.points,
    colorIndex: colorIndexForTrack[i],
    isVisible: true,
    isMuted: false,
  }));
};

if (!fs.existsSync(inputPath)) {
  console.error(`No such file or directory: ${inputPath}`);
  process.exit(1);
}

const midiFiles = findMidiFiles(inputPath);
if (!midiFiles.length) {
  console.error(`No .mid/.midi files found at: ${inputPath}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

console.log(`Found ${midiFiles.length} MIDI file(s). Writing line art to ${outDir}\n`);

let succeeded = 0;
const failed = [];

midiFiles.forEach(filePath => {
  const name = path.basename(filePath).replace(/\.midi?$/i, '');
  try {
    const shapesList = convertFileToShapesList(filePath);
    if (!shapesList) {
      failed.push({ filePath, reason: 'no usable tracks' });
      console.log(`  skip  ${name} (no usable tracks)`);
      return;
    }
    const svg = buildLineArtSVG(shapesList);
    if (!svg) {
      failed.push({ filePath, reason: 'no visible shapes' });
      console.log(`  skip  ${name} (no visible shapes)`);
      return;
    }
    fs.writeFileSync(path.join(outDir, `${name}.svg`), svg);
    succeeded += 1;
    console.log(`  ok    ${name}.svg`);
  } catch (err) {
    failed.push({ filePath, reason: err.message });
    console.log(`  FAIL  ${name} - ${err.message}`);
  }
});

console.log(`\n${succeeded} of ${midiFiles.length} converted successfully.`);
if (failed.length) {
  console.log(`${failed.length} failed or skipped:`);
  failed.forEach(({ filePath, reason }) => console.log(`  - ${filePath}: ${reason}`));
}
process.exit(succeeded === 0 && midiFiles.length > 0 ? 1 : 0);
