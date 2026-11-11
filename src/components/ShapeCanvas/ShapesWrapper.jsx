import React, { useRef, memo, forwardRef, useImperativeHandle } from 'react';
import Shape from 'components/Shape';
import { boundsIntersectRect } from 'utils/shapeCulling';

/* 
  - Handles the rendering of just the shapes onto the canvas. This avoids
    re-renders from project udpates unrelated to the shapes (eg. mouse position)
  - Provides imperative handle for calling functions on the shapes list
*/
export default memo(
  forwardRef((props, ref) => {
    const {
      shapesList,
      deletedShapeIndeces,
      selectedShapeIndex,
      selectedShapeIndices,
      soloedShapeIndices,
      snapToGrid,
      handleShapeClick,
      handleShapeDelete,
      handleShapeDuplicate,
      handleShapeColorChange,
      handleShapeVolumeChange,
      handleShapeStartOffsetChange,
      handleShapeSoloChange,
      handleShapeMuteChange,
      visibleShapeIndices,
      shapesGeneration,
    } = props;

    const shapeRefs = useRef({});

    useImperativeHandle(ref, () => ({
      getShapeState: shapeIndex => {
        const shapeRef = shapeRefs.current[shapeIndex.toString()];
        return shapeRef.getSaveDataState();
      },
      getShapeMIDISequences: () => {
        const shapesList = Object.keys(shapeRefs.current)
          .map(key => shapeRefs.current[key])
          .filter(val => !!val);
        return shapesList.map(shapeRef => shapeRef.getMIDINoteEvents());
      },
      // Sheet Preview's data source - one entry per currently-rendered
      // shape (deleted shapes have no ref, same filter getShapeMIDISequences
      // above uses), carrying colorIndex alongside so the preview can style
      // each staff to match its shape's color.
      getShapeNotationEvents: () =>
        Object.keys(shapeRefs.current)
          .map(key => ({ index: parseInt(key, 10), shapeRef: shapeRefs.current[key] }))
          .filter(({ shapeRef }) => !!shapeRef)
          .map(({ index, shapeRef }) => ({
            index,
            colorIndex: shapesList[index].colorIndex,
            noteEvents: shapeRef.getNotationNoteEvents(),
          })),
      // Viewport culling's own recompute (ShapeCanvas/Container.jsx, after
      // a pan/zoom settles) - queries every shape's own LIVE content
      // bounds (Shape/ComponentV2.jsx's getContentBounds, computed from
      // the points each shape actually holds right now, not whatever's
      // in the shapesList prop here, which can be stale for anything
      // that's been dragged/edited since import) and tests each against
      // the current viewport rect.
      getVisibleShapeIndices: viewportRect => {
        const visible = new Set();
        Object.keys(shapeRefs.current).forEach(key => {
          const shapeRef = shapeRefs.current[key];
          if (!shapeRef) return;
          if (boundsIntersectRect(shapeRef.getContentBounds(), viewportRect)) {
            visible.add(parseInt(key, 10));
          }
        });
        return visible;
      },
    }));

    return shapesList.map((shape, index) => {
      const {
        points,
        colorIndex,
        volume,
        isMuted,
        quantizeFactor,
        noteEvents,
        startOffset,
        loopDuration,
      } = shape;
      // undefined means an older/plain shape that's never had this
      // toggled - default to visible, same convention startOffset/
      // loopDuration already use for "no value set yet"
      const isVisible = shape.isVisible !== false;
      // undefined means an ordinary musical-canvas shape (hand-drawn,
      // MIDI import, trace, preset) - no normalization needed. See
      // Shape/ContainerV2.jsx's own comment on this prop.
      const audioScale = shape.audioScale || 1;
      // null visibleShapeIndices means no viewport-culling pass has run
      // yet (ShapeCanvas/Container.jsx) - default to "in view" rather
      // than culling everything until the first recompute lands
      const isInViewport = !visibleShapeIndices || visibleShapeIndices.has(index);
      return (
        !deletedShapeIndeces[index] && (
          <Shape
            ref={c => (shapeRefs.current[index.toString()] = c)}
            // shapesGeneration folded into the key - see
            // ShapeCanvas/Container.jsx's own comment on that field.
            // Plain `index` alone would let React reuse a shape at the
            // same array position across a wholesale replace (clearAll,
            // importMidiShapes) as if it were the SAME shape just
            // getting new props, instead of unmounting the old one
            // (disposing its synth, letting the new one seed its local
            // state fresh from ITS OWN initialPoints/initialNoteEvents).
            key={`${shapesGeneration}-${index}`}
            index={index}
            volume={volume}
            isMuted={isMuted}
            initialQuantizeFactor={quantizeFactor}
            initialPoints={points}
            initialNoteEvents={noteEvents}
            startOffset={startOffset}
            loopDuration={loopDuration}
            audioScale={audioScale}
            isVisible={isVisible}
            isInViewport={isInViewport}
            isSelected={index === selectedShapeIndex}
            isGroupSelected={selectedShapeIndices.has(index)}
            soloedShapeIndices={soloedShapeIndices}
            colorIndex={colorIndex}
            snapToGrid={snapToGrid}
            handleClick={handleShapeClick}
            handleDelete={handleShapeDelete}
            handleShapeDuplicate={handleShapeDuplicate}
            handleColorChange={handleShapeColorChange}
            handleVolumeChange={handleShapeVolumeChange}
            handleStartOffsetChange={handleShapeStartOffsetChange}
            handleSoloChange={handleShapeSoloChange}
            handleMuteChange={handleShapeMuteChange}
          />
        )
      );
    });
  })
);
