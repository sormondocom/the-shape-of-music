# The Shape of Music

_A geometric sequencer that suggests one answer to the question "What does a shape sound like?"._

![Project](assets/readme-images/project_screenshot_3.png)

> **This is a fork, and we want to be clear about that.** The original project, *Shape Your Music*, was
> created by [Elias Jarzombek](https://github.com/ejarzo) — see the upstream repo at
> [github.com/ejarzo/Shape-Your-Music](https://github.com/ejarzo/Shape-Your-Music), live at
> [shapeyourmusic.dev](https://shapeyourmusic.dev) (not affiliated with this fork - that site and domain
> belong to the original project, not us). All credit for the original concept, design, and
> implementation belongs to Elias and the upstream contributors. This fork
> ([sormondocom/the-shape-of-music](https://github.com/sormondocom/the-shape-of-music)), renamed *The
> Shape of Music*, builds on that original work with the additional features described in
> [Fork Additions](#-fork-additions) below.

## About

<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Geoboard.JPG/1280px-Geoboard.JPG" alt="drawing" width="100px"/>

The Shape of Music is a musical [geoboard](https://en.wikipedia.org/wiki/Geoboard) that explores a new way of composing and performing music using geometry.

Using this app, one can:

- Draw multiple shapes to generate unique polyrhythms
- Manipulate shapes in real time to improvise and perform
- Change and adjust the sound that shapes of each color produces
- Experiment with different musical modes, keys, and tempos
- Use grid and syncing options to create defined rhythms and loops
- Move shapes up or down to transpose them within the scale, or side to side to move them in stereo space
- Record and export your project as either an audio file or as MIDI files
- Save projects and browse other people's creations

---

## 📖 User Manual

### Overview

Sound is created by drawing polygons on the canvas and clicking PLAY (or space bar). Each polygon represents a looping musical phrase.

There are two modes: Draw and Edit (toggle between them with Tab). While in DRAW mode, clicking on the canvas allows you to draw polygons by placing vertices. In EDIT mode, You can **add** vertices by clicking on an edge midpoint, or **delete** vertices by double-clicking them. You can also drag each polygon to adjust its position, or drag the entire shape to a new position. Shapes higher up on the canvas start at higher notes than shapes lower down. Moving shapes left or right places them in stereo space (left/right on your speakers or headphones). Also in EDIT mode, you can click on a shape to display a context menu with more options.

Each shape is a certain color. The current color with which you are drawing is controlled with the color palette in the toolbar. A shape's color determines which instrument it uses to produce sound. The sounds for each color can be controlled with the colored panels at the bottom of the screen; if the red panel is set to the "Cello" instrument, every red shape will make a cello sound.

When a shape plays, a node traverses the perimeter of the shape at a constant speed, sounding a note at each vertex. The first note of a shape is determined by the shape's `y` position on the plane. The note for each subsequent edge is determined by the angle between that edge and the previous edge. This angle determines the musical interval between the two notes(edges). For example: A sharp right turn means that the next note is much higher than the previous, while a shallow left turn means that the next note is a little lower. When the last point is reached, the loop starts again.

For the precise mechanics (the exact angle-to-interval formula, how a shape's position sets its transposition, how this differs for MIDI-imported shapes, etc.), see [docs/PITCH_SYSTEM.md](docs/PITCH_SYSTEM.md).

### Toolbar

![Toolbar screenshot](assets/readme-images/toolbar.png)

The toolbar allows you to adjust various aspects of your project.

| Name           | Description                                                                                                                                                                                                                                                                                                                                                                                         |
|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Play/Stop      | Pressing play starts all shapes at their origin point. Shapes that are added during playback will start playing as soon as they are completed.                                                                                                                                                                                                                                                      |
| Record         | Pressing record allows you to download your project as an audio file (.wav). If playback is stopped when you click record, recording will begin when you begin playback. If the project is playing when you click record, the recording will start instantly. Pressing stop or record again will end the recording and show a window where you can listen and download the file that was generated. |
| Color          | Select the color of the shapes you are drawing. Different colored shapes produce different sounds.                                                                                                                                                                                                                                                                                                  |
| Draw Tool      | Draw mode allows you to create shapes. Click to place vertices. Click on the origin point to complete a shape. Right click to cancel.                                                                                                                                                                                                                                                               |
| Edit Tool      | Edit mode allows you to adjust your shapes. Drag vertices to edit the perimeter of your shape. Drag the whole shape to move it. Click on a shape to show more detailed options (see shape controls).                                                                                                                                                                                                |
| Grid           | When selected, the grid is shown and all points will snap to the grid when drawn, or when shapes are moved                                                                                                                                                                                                                                                                                          |
| Sync           | When selected, shapes will snap and lock to the same length - so that they will loop at the same time. Shapes can be “halved’ or “doubled” so that they loop half or twice as often. This allows for a defined rhythm.                                                                                                                                                                              |
| Proximity Mode | Turn on Proximity Mode to experience your project spatially, where the listening position is controlled with the mouse. Hover over the dropdown icon to adjust the listening radius.                                                                                                                                                                                                                |
| Tempo          | Change the speed of playback                                                                                                                                                                                                                                                                                                                                                                        |
| Key            | Select the root note                                                                                                                                                                                                                                                                                                                                                                                |
| Scale          | Select the musical scale (mode)                                                                                                                                                                                                                                                                                                                                                                     |
| Clear          | Delete all shapes                                                                                                                                                                                                                                                                                                                                                                                   |

### Exporting

There are two ways to export your project: as audio or as MIDI.
1. **Audio**: Recording audio works like many DAWs. Click the record button to begin recording. Recording will begin when playback starts and captures the audio output of the project. Clicking record again or stopping playback will stop the current recording, which can then be downloaded as a `.wav` file from the Downloads section in the sidebar.
2. **MIDI**: Click the `Export to MIDI` icon on the left to download the project as a folder of MIDI files, one for each shape. Since the tempo is not synced to any real BPM, the melodies may sound slower or faster when loaded into another program, but all shapes will maintain their relative lengths.

### Shape Menu

![image](https://user-images.githubusercontent.com/9386882/107823235-73f0c380-6d4d-11eb-94c8-5c8ce5312639.png)

The Shape menu allows you to control a shape's properties. CLICK on a shape (in EDIT mode) to display this menu.

| Control        | Description                     |
| -------------- | ------------------------------- |
| Volume Slider  | The left side of the panel is a volume slider. Drag the white bar to adjust how loud the shape is  |
| Mute (toggle)  | When selected, the shape produces no sound |
| Solo (toggle)  | When selected, the shape will be the only shape producing sound |
| Color          | Change the shape's color. This will change its sound to the corresponding instrument for that color |
| \*2            | Doubles the perimeter of the shape, making the loop last for twice as long |
| \2             | Halves the perimeter of the shape, making the loop last for half as long |
| Reverse        | Reverse the direction of playback. Reversing the direction will recalculate the notes based on the new angles - instead of simply playing the notes in opposite order |
| To Front       | Moves the shape to the front of the canvas -- has no effect on the audio |
| To Back        | Moves the shape to the back of the canvas -- has no effect on the audio |
| Duplicate      | Creates a clone of the shape |
| Delete Shape   | Deletes the shape from the canvas |


### Color Controller

![Color Controller](assets/readme-images/color-controller-blue.png)

The Color Controller allows you to change the sound generated by shapes of that color. Each colored panel is one of up to 16 instrument channels:

- Click the instrument name to open the picker and choose a sound - either one of the built-in synths, or (once a SoundFont is loaded) any General MIDI instrument from it. Each entry in the picker has its own preview button to audition it before picking.
- Click the color swatch to reassign that channel to a different one of the 16 palette colors.
- Click the play icon in the panel's title bar to preview the currently-assigned instrument.
- Use the `+` panel at the end of the row to add another instrument channel (up to 16 total); use the `x` on a panel to remove it. Removing a channel only stops offering its color for new shapes - existing shapes already drawn in that color keep playing.
- The strip above the panels shows which SoundFont is currently loaded (a bundled [GeneralUser GS](https://github.com/adius/GeneralUser) SoundFont loads automatically) and lets you upload your own `.sf2`/`.sf3` file, which replaces it for every SoundFont-backed channel.

---

## 🧵 Fork Additions

This fork adds the following on top of the original project:

**Sound & instruments**
- SoundFont (SF2/SF3) support via [spessasynth_lib](https://github.com/spessasus/SpessaSynth) - upload your own SoundFont, or use the bundled default [GeneralUser GS](https://github.com/adius/GeneralUser)
- Dynamic instrument channels: start with one instrument and add/remove channels up to the full 16-channel MIDI range, instead of a fixed set of 5
- Per-channel color reassignment and sound preview/audition for both built-in and SoundFont instruments

**Canvas & navigation**
- Scroll-to-zoom and WASD/Z/Q panning and zooming, with shape rendering, the active-note cursor, and the shape editor panel all kept zoom-aware (crisp at any zoom level, consistent apparent size, pinned to the canvas corner)

**Shapes & composition**
- Predefined shape insertion
- Image tracing - generate shapes from a reference image
- Multi-select and group recoloring of shapes
- A Layers panel for managing shapes outside the canvas

**Import/export**
- MIDI import
- Absolute-pitch ("exact audio") playback mode
- MP3 export, alongside the existing WAV and MIDI export

**Visualization**
- A real-time audio spectrometer panel (FFT frequency display)

---

## 💻 Development

### Front End
The front end is a React app, created using [`create-react-app`](https://github.com/facebook/create-react-app).
It uses:
- [Tone.js](https://github.com/Tonejs/Tone.js) for music/audio generation
- [React Konva](https://github.com/konvajs/react-konva) for canvas manipulation
- [Teoria](https://github.com/saebekassebil/teoria) for music theory logic
- [Ant Design](https://ant.design/docs/react/introduce) for several UI components


To run: `yarn` and then `yarn start:app`.

### Backend
_NOTE: If you just want to play around with the client code, you can ignore this setup. Just use `yarn start:app`_

The backend consists of a [Firestore database](https://firebase.google.com/docs/firestore) and serverless [Netlify functions](https://www.netlify.com/docs/functions/) (in [`netlify/functions`](netlify/functions)) to provide an API for viewing and saving projects. It uses [Netlify Identity](https://www.netlify.com/docs/identity/) to handle users, account creation and login.

> This fork originally inherited a FaunaDB backend from the upstream project and has since migrated to
> Firestore (see `scripts/import-fauna-data-to-firestore.js`) - if you're looking at older forks or the
> upstream repo, their backend setup will differ from what's below.

If you want to be able to save data locally, you will need a [Firebase project](https://console.firebase.google.com/) (it's free) with Firestore enabled, and a service account key for it.

If everything is already setup, run with `yarn start:server`.

#### Firestore Setup
1. Create a project at the [Firebase console](https://console.firebase.google.com/).
2. In that project, enable **Firestore Database** (Build > Firestore Database > Create database).
3. Go to **Project Settings > Service Accounts**, and click **Generate new private key**. This downloads a JSON file - keep it secret, it's a credential.
4. In your local environment (NOTE: this will NOT be your react app `.env` file. This will be your `~/.bash_profile`, `~/.zshrc`, etc.), set a variable `FIREBASE_ADMIN_CREDENTIALS` to the **entire contents** of that JSON file, as a single-line string.
5. Reload your terminal session and run `yarn start:server`.

#### Netlify Setup
Netlify is used to handle user accounts through their [Identity](https://www.netlify.com/docs/identity/) feature. To fully integrate with the backend and be able to save your projects locally, you will need a Netlify account. Once you have an account, use their [CLI](https://www.netlify.com/docs/cli/) to login and initialize a project for this repo. Try signing up through the UI and you should get a confirmation email that redirects to your netlify project.


### Testing

The original project's end-to-end tests (canvas/Web Audio, via [puppeteer](https://pptr.dev/)) live in a
[separate upstream repo](https://github.com/ejarzo/sym-tests) - this fork hasn't kept its own test suite in
sync with that one, so treat it as a reference for the original project's approach rather than as coverage
for the current state of this fork.

