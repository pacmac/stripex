// Physical constants of standard stripboard, and hole <-> millimetre conversion.
//
// These are measured values from supplier datasheets, verified 2026-08-29, not
// convenient round numbers. The check that they are one coherent set rather than
// three sources averaged together is that TRACK_W_MM + TRACK_GAP_MM is exactly
// PITCH_MM — the copper fills the pitch minus the etched gap, by construction.
// tests/net/test_connectivity.mjs asserts that identity, so a future edit that
// tweaks one of the three without the others is caught rather than shipped.

export const PITCH_MM = 2.54;        // 0.1 inch
export const HOLE_DIA_MM = 1.0;
export const TRACK_W_MM = 2.0;
export const TRACK_GAP_MM = 0.54;
export const BOARD_THICK_MM = 1.6;
export const COPPER_UM = 35;

// Outside dimensions of a cols x rows board. The outer holes end up a half pitch
// (1.27 mm) from each edge, which is the standard margin stripboard is cut to.
export function boardSizeMm(board) {
  return { w: board.cols * PITCH_MM, h: board.rows * PITCH_MM };
}

// Centre of a hole, in millimetres from the top-left corner of the board, as seen
// from the COMPONENT side. Nothing here is mirrored; mirroring for the underside
// view is the exporter's job and must not leak into the model.
export function holeToMm(col, row) {
  return { x: (col + 0.5) * PITCH_MM, y: (row + 0.5) * PITCH_MM };
}

// Nearest hole to a point in millimetres, or null if it falls outside the matrix.
// Used by the editor for hit-testing; kept here so there is exactly one place
// that knows the grid origin.
export function mmToHole(x, y, board) {
  const col = Math.round(x / PITCH_MM - 0.5);
  const row = Math.round(y / PITCH_MM - 0.5);
  if (col < 0 || row < 0 || col >= board.cols || row >= board.rows) return null;
  return { col, row };
}
