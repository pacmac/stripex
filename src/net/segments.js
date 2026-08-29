// Strip segments: the maximal runs of uncut copper.
//
// THE BREAK CONVENTION, which everything downstream depends on:
//
//     A break is a cut BETWEEN two adjacent holes, never at a hole.
//     { row, x } cuts the copper between hole x and hole x+1 of that row.
//     Valid x is 0 .. cols-2.
//
// An off-by-half-a-hole here is the classic stripboard-software defect: it
// produces a drill list wrong by one hole and a board that cannot work. So a
// break outside the valid range THROWS rather than being clamped or ignored —
// a silently dropped cut is a short circuit on somebody's bench.

export function segments(board, breaks = []) {
  const { cols, rows } = board;

  const byRow = new Map();
  for (const b of breaks) {
    if (!Number.isInteger(b.row) || b.row < 0 || b.row > rows - 1) {
      throw new Error(`break row ${b.row} is outside 0..${rows - 1}`);
    }
    if (!Number.isInteger(b.x) || b.x < 0 || b.x > cols - 2) {
      throw new Error(
        `break x ${b.x} is outside 0..${cols - 2} — a break sits between hole x and x+1, `
        + 'so the last valid gap is cols-2',
      );
    }
    if (!byRow.has(b.row)) byRow.set(b.row, new Set());
    byRow.get(b.row).add(b.x);   // cutting the same gap twice is still one cut
  }

  const out = [];
  for (let row = 0; row < rows; row += 1) {
    const cuts = [...(byRow.get(row) ?? [])].sort((a, b) => a - b);
    let x0 = 0;
    let idx = 0;
    for (const c of cuts) {
      out.push({ id: `s:${row}:${idx}`, row, x0, x1: c });
      idx += 1;
      x0 = c + 1;
    }
    out.push({ id: `s:${row}:${idx}`, row, x0, x1: cols - 1 });
  }
  return out;
}

// hole key -> segment id, for every hole on the board.
export function segmentIndex(segs) {
  const idx = new Map();
  for (const g of segs) {
    for (let x = g.x0; x <= g.x1; x += 1) idx.set(`${x},${g.row}`, g.id);
  }
  return idx;
}

export const holeKey = (col, row) => `${col},${row}`;
