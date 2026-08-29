// Breaks a package cannot work without.
//
// Two packages in the library declare `requiresBreak`, for the same reason from
// opposite directions:
//
//   A DIL straddles the strips, so pin n and its opposite pin land on the same
//   row and therefore the same strip. Every strip running under the package must
//   be cut — seven cuts for a DIP-14 — or the chip is shorted pin to pin.
//
//   An SMT 0603 has both poles on ONE strip and is soldered across a cut. Without
//   the cut it is a blob of solder shorting itself out.
//
// One rule covers both: wherever a placement puts two of its own pins on the same
// row, the strip between them has to be cut.

import { resolvePins } from './rotate.js';

// The gap index that separates two holes in the same row. A gap `x` cuts between
// hole x and hole x+1, so separating columns a and b (a < b) needs a <= x < b.
// Midway keeps the cut clear of both leads, which matters when you are holding a
// craft knife rather than a CNC.
export const gapBetween = (a, b) => Math.floor((a + b - 1) / 2);

// The cuts a placement needs before it can work. Returns [] for a part that
// declares no such requirement — a resistor lying along a strip is also shorted,
// but that is the user's mistake to see reported, not a package whose datasheet
// demands a cut.
export function requiredBreaks(placement, getPart) {
  let part;
  try { part = getPart(placement.part); } catch { return []; }
  if (!part.requiresBreak) return [];

  const byRow = new Map();
  for (const p of resolvePins([placement], getPart)) {
    if (!p.electrical) continue;
    if (!byRow.has(p.row)) byRow.set(p.row, []);
    byRow.get(p.row).push(p.col);
  }

  const out = [];
  for (const [row, colsInRow] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const cols = [...new Set(colsInRow)].sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i += 1) {
      out.push({ row, x: gapBetween(cols[i - 1], cols[i]), at: 'gap' });
    }
  }
  return out;
}

const keyOf = (b) => `${b.row}:${b.x}:${b.at ?? 'gap'}`;

// Add the cuts that are not already there. A cut already present — of either
// kind, at the same place — is not duplicated.
//
// The result is a plain list of ordinary breaks. Auto-inserted cuts are NOT
// tracked as belonging to their part, because a cut in a real board is permanent:
// lifting the chip off does not un-cut the copper underneath it. Modelling them
// as removable-with-the-part would describe a board you cannot build.
export function mergeBreaks(existing = [], additions = []) {
  const seen = new Set(existing.map(keyOf));
  const alsoAsHole = new Set(existing.map((b) => `${b.row}:${b.x}`));
  const out = [...existing];
  for (const b of additions) {
    if (seen.has(keyOf(b)) || alsoAsHole.has(`${b.row}:${b.x}`)) continue;
    seen.add(keyOf(b));
    alsoAsHole.add(`${b.row}:${b.x}`);
    out.push(b);
  }
  return out;
}

// Does this placement still lack a cut it needs? Returns the missing ones, given
// the segment index, so the DRC can name the exact gap to cut rather than saying
// "shorted" and leaving the user to work out where.
export function missingBreaks(placement, getPart, segmentIndexMap) {
  const need = requiredBreaks(placement, getPart);
  const pins = resolvePins([placement], getPart).filter((p) => p.electrical);
  const segOf = (col, row) => segmentIndexMap.get(`${col},${row}`);

  return need.filter((b) => {
    const cols = pins.filter((p) => p.row === b.row).map((p) => p.col).sort((x, y) => x - y);
    // Still missing if any two pins on this row remain on one segment.
    for (let i = 1; i < cols.length; i += 1) {
      const a = segOf(cols[i - 1], b.row);
      const z = segOf(cols[i], b.row);
      if (a !== undefined && a === z) return true;
    }
    return false;
  });
}
