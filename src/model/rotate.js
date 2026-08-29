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
    for (const pin of pinsOf(part, pl.span)) {
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

// The holes a placement covers, for hit-testing and collision highlighting in
// the editor. Body outlines are the renderer's business; this is pins only.
export function placementHoles(placement, getPart) {
  return resolvePins([placement], getPart).map((p) => ({ col: p.col, row: p.row }));
}
