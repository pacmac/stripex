// Rotation of part pins about their placement anchor, and resolution of
// placements into absolute holes.

import { pinsOf } from '../parts/library.js';

const ROTATIONS = new Set([0, 90, 180, 270]);

// Clockwise as seen from the COMPONENT side, which is the side the editor shows.
// Screen y runs downwards, so +x -> +y is a clockwise quarter turn on screen.
export function rotate(dx, dy, rot) {
  switch (rot) {
    case 0: return [dx, dy];
    case 90: return [-dy, dx];
    case 180: return [-dx, -dy];
    case 270: return [dy, -dx];
    default: throw new Error(`bad rotation: ${rot} (want 0, 90, 180 or 270)`);
  }
}

export function isRotation(rot) {
  return ROTATIONS.has(rot);
}

// Absolute pins for a list of placements.
//
// Key order of the returned objects is fixed and asserted by the tests, because
// a serialised project is diffed by humans and a wandering key order makes every
// save look like a change.
export function resolvePins(placements, getPart) {
  const out = [];
  for (const pl of placements) {
    const part = getPart(pl.part);
    for (const pin of pinsOf(part, pl.span, pl.width)) {
      const [dx, dy] = rotate(pin.dx, pin.dy, pl.rot ?? 0);
      out.push({
        ref: pl.ref,
        pin: pin.name,
        col: pl.at.col + dx,
        row: pl.at.row + dy,
        electrical: pin.electrical !== false,
        kind: part.kind,
      });
    }
  }
  return out;
}

// Turn a placement where it sits.
//
// resolvePins pivots each pin about the ANCHOR, which is right for the model: a
// placement is an anchor plus an angle, and the anchor has to be a hole. It is
// wrong for the gesture — clicking Rotate should turn the part where it is, not
// swing it around one of its own legs and fling half of it off the board, which
// is what two of the four angles used to do.
//
// So: turn it, then shift the anchor back by however far the pin bounding-box
// centre moved.
//
// The shift is ROUNDED because the anchor must land on a hole. A part with an
// even pin span has its centre on a hole and an odd one has it on a boundary,
// and only one of those survives exactly — so the centre may move by up to half
// a hole per turn. What must NOT drift is the round trip: four turns return the
// placement to precisely where it started.
//
// That round trip is why the rounding is half-away-from-zero rather than
// Math.round. Rotating 180 degrees negates a centre offset, so c180 = -c0 and
// c270 = -c90, which makes the four per-turn deltas exactly d, e, -d, -e. An ODD
// rounding function therefore sums them to zero for every part, whatever its
// geometry. Math.round is not odd — it sends 1.5 to 2 but -1.5 to -1 — and a
// DIP-14 accordingly crept two holes diagonally every full turn.
const roundHalfAway = (x) => Math.sign(x) * Math.round(Math.abs(x));

export function rotatePlacement(placement, getPart, quarterTurns = 1) {
  const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
  const next = { ...placement, at: { ...placement.at } };
  if (turns === 0) return next;

  next.rot = (((placement.rot ?? 0) + 90 * turns) % 360 + 360) % 360;

  const spanOf = (pl) => {
    const pins = resolvePins([{ ...pl, at: { col: 0, row: 0 } }], getPart);
    const cols = pins.map((p) => p.col);
    const rows = pins.map((p) => p.row);
    return {
      col: (Math.min(...cols) + Math.max(...cols)) / 2,
      row: (Math.min(...rows) + Math.max(...rows)) / 2,
    };
  };

  // Both centres are measured from a zero anchor, so their difference is exactly
  // how far the part drifted, independent of where it happens to sit.
  const was = spanOf(placement);
  const now = spanOf(next);

  next.at.col = placement.at.col + roundHalfAway(was.col - now.col);
  next.at.row = placement.at.row + roundHalfAway(was.row - now.row);
  return next;
}

// The holes a placement covers, for hit-testing and collision highlighting in
// the editor. Body outlines are the renderer's business; this is pins only.
export function placementHoles(placement, getPart) {
  return resolvePins([placement], getPart).map((p) => ({ col: p.col, row: p.row }));
}
