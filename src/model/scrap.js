// A SCRAP OF BOARD FOR ONE PART: the pins' own block plus one strip all round,
// with the placement shifted onto it.
//
// Shared by the Library's footprints and the component editor's preview, so the
// two can never disagree about how a part is framed — which is exactly what
// happened when this lived inside one of them: the Library's call threw, its
// catch turned that into the stand-in icon, and every item in the drawer became
// the same picture. See docs/specs/library-thumbnails-back.md.
//
// Pure, and in the model rather than in a screen: no DOM, so node can check it
// and either screen can import it.
//
// Built, not mutated: the caller's placement is copied, and the project never
// leaves the caller.

import { makeProject } from './board.js';
import { resolvePins } from './rotate.js';
import { getPart } from '../parts/library.js';

export function scrapProjectFor(placement, part = getPart) {
  const pl = { ...placement, at: { col: 1, row: 1 } };
  const at1 = resolvePins([pl], part);
  const cs = at1.map((q) => q.col);
  const rs = at1.map((q) => q.row);
  // Shift so the top-left pin lands one strip in from the corner, then make the
  // board that block plus the same strip on the far side.
  pl.at = { col: 1 + (1 - Math.min(...cs)), row: 1 + (1 - Math.min(...rs)) };
  const cols = Math.max(...cs) - Math.min(...cs) + 3;
  const rows = Math.max(...rs) - Math.min(...rs) + 3;
  return { ...makeProject({ cols, rows, name: 'preview' }), placements: [pl] };
}
