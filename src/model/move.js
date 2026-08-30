// Moving a device point to point, by one of its pins.
//
// Two clicks on two holes have nothing to guess: the pin you picked goes in the
// hole you clicked, exactly. A drag has to work out where the part landed from
// where the pointer was released and then snap that guess to the grid, which
// means a tolerance to tune and an "it dropped one hole out" to report.
//
// Picking the pin also matters when the part is bigger than the space around it:
// you can grab pin 1 of a DIL or the cathode of a diode and put THAT pin where
// it has to go, rather than aiming the part's middle at nothing in particular.

import { resolvePins } from './rotate.js';

// Returns a NEW placement translated so that `pinName` sits in `target`.
// Rotation, span and width are untouched: this is a move, not a transform.
//
// An unknown pin or an unknown part returns the placement unchanged rather than
// throwing. A handle can go stale between the two clicks — the part edited, or
// replaced — and that must not take the editor down.
export function movePlacementByPin(placement, getPart, pinName, target) {
  if (!target || !Number.isInteger(target.col) || !Number.isInteger(target.row)) {
    return placement;
  }
  let pins;
  try {
    pins = resolvePins([placement], getPart);
  } catch {
    return placement;
  }
  const pin = pins.find((p) => p.pin === String(pinName));
  if (!pin) return placement;

  return {
    ...placement,
    at: {
      col: placement.at.col + (target.col - pin.col),
      row: placement.at.row + (target.row - pin.row),
    },
  };
}

// Where a given pin of a placement currently is, or null. Used by the editor to
// draw the armed handle and to name it in the status line.
export function pinLocation(placement, getPart, pinName) {
  try {
    const p = resolvePins([placement], getPart).find((x) => x.pin === String(pinName));
    return p ? { col: p.col, row: p.row } : null;
  } catch {
    return null;
  }
}
