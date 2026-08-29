// Strip segments: the maximal runs of uncut copper.
//
// THERE ARE TWO WAYS TO CUT A TRACK, and they are not the same operation.
//
//   { row, x, at: 'gap' }   A KNIFE between hole x and hole x+1.
//                           Both holes keep their copper. Valid x: 0 .. cols-2.
//
//   { row, x, at: 'hole' }  A SPOT-FACE CUTTER at hole x.
//                           Valid x: 0 .. cols-1.
//                           The hole ITSELF IS DEAD: a 3 mm cutter centred on a
//                           hole removes copper 1.5 mm each way, past the
//                           1.27 mm midpoints to both neighbours. So the strip
//                           is severed AND the hole belongs to no segment.
//
// `at` absent means 'gap', so every project saved before the spot-face existed
// keeps its meaning.
//
// An off-by-half-a-hole here is the classic stripboard-software defect: it
// produces a drill list wrong by one hole and a board that cannot work. So a
// break outside the valid range THROWS rather than being clamped or ignored —
// a silently dropped cut is a short circuit on somebody's bench.

export const cutTypeOf = (b) => b.at ?? 'gap';

export function segments(board, breaks = []) {
  const { cols, rows } = board;

  const gapsByRow = new Map();
  const deadByRow = new Map();

  for (const b of breaks) {
    const at = cutTypeOf(b);
    if (at !== 'gap' && at !== 'hole') {
      throw new Error(`break at "${b.at}" is not a cut type — want "gap" or "hole"`);
    }
    if (!Number.isInteger(b.row) || b.row < 0 || b.row > rows - 1) {
      throw new Error(`break row ${b.row} is outside 0..${rows - 1}`);
    }
    const last = at === 'gap' ? cols - 2 : cols - 1;
    if (!Number.isInteger(b.x) || b.x < 0 || b.x > last) {
      throw new Error(
        `break x ${b.x} is outside 0..${last} — ${at === 'gap'
          ? 'a knife cut sits between hole x and x+1, so the last valid gap is cols-2'
          : 'a spot-face sits at hole x, so the last valid hole is cols-1'}`,
      );
    }
    const map = at === 'gap' ? gapsByRow : deadByRow;
    if (!map.has(b.row)) map.set(b.row, new Set());
    map.get(b.row).add(b.x);   // cutting the same place twice is still one cut
  }

  const out = [];
  for (let row = 0; row < rows; row += 1) {
    const gaps = gapsByRow.get(row) ?? new Set();
    const dead = deadByRow.get(row) ?? new Set();

    // Walk the row hole by hole and close a run wherever the copper stops. A run
    // that would be empty emits NO segment: a zero-hole segment is a net with
    // nothing on it, and it would show up in the net list as a phantom.
    let idx = 0;
    let start = null;
    const close = (endInclusive) => {
      if (start === null) return;
      out.push({ id: `s:${row}:${idx}`, row, x0: start, x1: endInclusive });
      idx += 1;
      start = null;
    };

    for (let x = 0; x < cols; x += 1) {
      if (dead.has(x)) { close(x - 1); continue; }
      if (start === null) start = x;
      if (gaps.has(x)) close(x);
    }
    close(cols - 1);
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
