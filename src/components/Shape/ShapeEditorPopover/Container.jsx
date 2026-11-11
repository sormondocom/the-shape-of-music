import React, { Component } from 'react';
import ShapeEditorPopoverComponent from './Component';

const WIDTH = 225;
const HEIGHT = 290;
const TOP_PAD = 16;
// Wider than TOP_PAD: the canvas's upper-left corner isn't actually "free"
// - Sidebar's save/downloads/export tab buttons (left: 0, ~54px wide with
// their box-shadow) live right there too. Clears them with a little
// margin; keep this in sync with Sidebar/styles.module.css's `left` if
// that changes.
const LEFT_PAD = 110;

/*
  Shape Editor Panel: appears when a shape is clicked on.
  Used to adjust/mix the shape.

  Pinned to a fixed spot in the canvas's upper area rather than positioned
  near the clicked shape - it used to follow the click position (in screen
  pixels), which meant at any non-default zoom/pan the panel could end up
  computed from a position far outside the viewport (the shape itself can
  be anywhere on an effectively unbounded zoomable/pannable canvas),
  pushing the panel off-screen entirely. A fixed spot is simple, always
  visible, and immune to zoom/pan by construction - Portal (in
  ComponentV2.jsx) still mounts this to document.body, so left/top below
  are viewport-relative; #holder's own on-page offset is added so it lines
  up with the actual canvas regardless of page layout (same pattern
  already used by GroupSelectionPanel/ReferenceImage's action panel).
  LEFT_PAD (rather than reusing TOP_PAD for both axes) keeps it clear of
  the other fixed UI that also lives in that corner - see LEFT_PAD's own
  comment.
*/
class ShapeEditorPopover extends Component {
  constructor(props) {
    super(props);

    const holderEl = document.getElementById('holder');
    const holderRect = holderEl
      ? holderEl.getBoundingClientRect()
      : { top: 0, left: 0 };

    this.state = {
      panelStyle: {
        width: WIDTH,
        height: HEIGHT,
        left: holderRect.left + LEFT_PAD,
        top: holderRect.top + TOP_PAD,
      },
    };
  }

  render() {
    return (
      <ShapeEditorPopoverComponent {...this.props} panelStyle={this.state.panelStyle} />
    );
  }
}

export default ShapeEditorPopover;
