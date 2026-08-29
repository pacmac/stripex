// Which cursor the board shows for each tool.
//
// This is a module rather than a CSS rule so that node can check the mapping.
// A cursor expressed only as a stylesheet selector is a claim nothing verifies,
// and adding a sixth tool without a cursor would show up as a stuck crosshair
// rather than as a failing check.

// crosshair for the three tools that aim at an exact point on a 2.54 mm grid;
// the ordinary pointer for the two that target an object, where a crosshair
// would wrongly imply a coordinate.
export const CURSORS = {
  select: 'default',
  place: 'crosshair',
  break: 'crosshair',
  wire: 'crosshair',
  delete: 'default',
};

export const DEFAULT_CURSOR = 'default';

// Falls back to a real keyword, never to undefined: assigning undefined leaves
// whatever cursor was set last, so the board would keep a crosshair after
// switching back to select.
export function cursorFor(tool) {
  return CURSORS[tool] ?? DEFAULT_CURSOR;
}
