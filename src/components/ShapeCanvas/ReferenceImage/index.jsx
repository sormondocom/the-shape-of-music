import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Image, Rect, Transformer } from 'react-konva';
import Portal from 'react-portal';
import cx from 'classnames';

import styles from './styles.module.css';

const propTypes = {
  referenceImage: PropTypes.shape({
    src: PropTypes.string.isRequired,
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
  }),
  stageScale: PropTypes.number.isRequired,
  stagePos: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  isSelected: PropTypes.bool.isRequired,
  onSelectedChange: PropTypes.func.isRequired,
  onTransformChange: PropTypes.func.isRequired,
  onAutoTrace: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

/*
  The reference image is always draggable/selectable, independent of the
  Draw/Edit tool - it's a visual aid, not a musical shape, so it shouldn't
  require switching tools to move it out of the way or trace it.

  `isSelected` is lifted to shared project state (rather than local state)
  so the Toolbar can also select/deselect it directly - clicking on the
  canvas doesn't work once shapes (e.g. traced ones) are sitting visually
  on top of the image and intercepting the click.
*/
// stage.getPointerPosition() is raw screen pixels relative to the canvas
// container, unaffected by the stage's own zoom/pan - convert it into
// content-space coordinates (matching where shapes/images actually live)
// before using it for anything other than screen-space DOM positioning.
const getContentPointerPosition = stage => {
  const pos = stage.getPointerPosition();
  const scale = stage.scaleX();
  return {
    x: (pos.x - stage.x()) / scale,
    y: (pos.y - stage.y()) / scale,
  };
};

function ReferenceImage(props) {
  const {
    referenceImage,
    stageScale,
    stagePos,
    isSelected,
    onSelectedChange,
    onTransformChange,
    onAutoTrace,
    onDelete,
  } = props;
  const [imageEl, setImageEl] = useState(null);
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [selectionRect, setSelectionRect] = useState(null);
  const imageRef = useRef();
  const trRef = useRef();
  const areaDragStartRef = useRef(null);

  const referenceImageSrc = referenceImage && referenceImage.src;

  useEffect(() => {
    if (!referenceImageSrc) {
      setImageEl(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setImageEl(img);
    img.src = referenceImageSrc;
  }, [referenceImageSrc]);

  useEffect(() => {
    if (!isSelectingArea && trRef.current && imageRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelectingArea, imageEl]);

  // reset area-selection state whenever the image is swapped out
  useEffect(() => {
    setIsSelectingArea(false);
    setSelectionRect(null);
  }, [referenceImageSrc]);

  if (!referenceImage || !imageEl) {
    return null;
  }

  const handleTransformEnd = () => {
    const node = imageRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onTransformChange({
      x: node.x(),
      y: node.y(),
      width: node.width() * scaleX,
      height: node.height() * scaleY,
    });
  };

  const handleAreaMouseDown = e => {
    const pos = getContentPointerPosition(e.target.getStage());
    areaDragStartRef.current = pos;
    setSelectionRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleAreaMouseMove = e => {
    if (!areaDragStartRef.current) return;
    const pos = getContentPointerPosition(e.target.getStage());
    const start = areaDragStartRef.current;
    setSelectionRect({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    });
  };

  const handleAreaMouseUp = () => {
    areaDragStartRef.current = null;
  };

  // Portal content is appended to document.body, outside #holder, so its
  // position:absolute top/left are viewport-relative - add #holder's own
  // offset so the panel lines up with the image regardless of page layout.
  const holderEl = document.getElementById('holder');
  const holderRect = holderEl
    ? holderEl.getBoundingClientRect()
    : { top: 0, left: 0 };
  const panelTop = Math.max(
    0,
    holderRect.top + referenceImage.y * stageScale + stagePos.y - 36
  );
  const panelLeft = holderRect.left + referenceImage.x * stageScale + stagePos.x;

  return (
    <>
      <Image
        ref={imageRef}
        image={imageEl}
        x={referenceImage.x}
        y={referenceImage.y}
        width={referenceImage.width}
        height={referenceImage.height}
        opacity={0.6}
        stroke={isSelected ? '#00aaff' : undefined}
        strokeWidth={isSelected ? 2 : 0}
        draggable={!isSelectingArea}
        onClick={() => onSelectedChange(!isSelected)}
        onContextMenu={e => {
          e.evt.preventDefault();
          onSelectedChange(true);
        }}
        onDragEnd={handleTransformEnd}
        onTransformEnd={handleTransformEnd}
      />
      {!isSelectingArea && (
        <Transformer ref={trRef} rotateEnabled={false} keepRatio={false} />
      )}

      {/* transparent overlay that captures the area-selection drag gesture */}
      {isSelectingArea && (
        <Rect
          x={referenceImage.x}
          y={referenceImage.y}
          width={referenceImage.width}
          height={referenceImage.height}
          fill="transparent"
          onMouseDown={handleAreaMouseDown}
          onMouseMove={handleAreaMouseMove}
          onMouseUp={handleAreaMouseUp}
        />
      )}

      {selectionRect && (
        <Rect
          x={selectionRect.x}
          y={selectionRect.y}
          width={selectionRect.width}
          height={selectionRect.height}
          stroke="white"
          dash={[4, 4]}
          strokeWidth={1.5}
          listening={false}
        />
      )}

      {isSelected && (
        <Portal isOpened>
          <div
            className={styles.actionPanel}
            style={{ top: panelTop, left: panelLeft }}
          >
            <button
              className={styles.actionButton}
              onClick={() => onAutoTrace(imageEl, null)}
            >
              Auto-Trace
            </button>
            <button
              className={cx(styles.actionButton, {
                [styles.actionButtonActive]: isSelectingArea,
              })}
              onClick={() => {
                setIsSelectingArea(prev => !prev);
                setSelectionRect(null);
              }}
            >
              Select Area
            </button>
            {selectionRect && selectionRect.width > 2 && selectionRect.height > 2 && (
              <button
                className={styles.actionButton}
                onClick={() => {
                  onAutoTrace(imageEl, {
                    x: (selectionRect.x - referenceImage.x) / referenceImage.width,
                    y: (selectionRect.y - referenceImage.y) / referenceImage.height,
                    width: selectionRect.width / referenceImage.width,
                    height: selectionRect.height / referenceImage.height,
                  });
                  setSelectionRect(null);
                  setIsSelectingArea(false);
                }}
              >
                Trace Selected Area
              </button>
            )}
            {(isSelectingArea || selectionRect) && (
              <button
                className={styles.actionButton}
                onClick={() => {
                  setIsSelectingArea(false);
                  setSelectionRect(null);
                }}
              >
                Cancel
              </button>
            )}
            <button
              className={styles.actionButton}
              onClick={() => onDelete()}
            >
              Delete Image
            </button>
            <button
              className={styles.actionButton}
              onClick={() => onSelectedChange(false)}
            >
              Close
            </button>
          </div>
        </Portal>
      )}
    </>
  );
}

ReferenceImage.propTypes = propTypes;

export default ReferenceImage;
