// Design rule checks over a stripboard layout.
//
// Everything here is derived from the segment graph, which is why it can catch
// the one mistake that actually ruins a hand-drawn stripboard layout:
// short-across-part, a component whose two legs land on the same uncut strip.
// That is invisible without segment derivation and obvious with it.
//
// A LIST OF RULES, NOT ONE FUNCTION. Each check is an entry in RULES — a name
// and a pure function of the context — and drc() builds the context once and
// runs them in order. A new check (netlist conformance, an accepted finding) is
// a new entry rather than another branch inside the function every other check
// lives in, and one rule can be run on its own over a context.
// See docs/specs/drc-as-a-list-of-rules.md.

import { segments, segmentIndex, holeKey } from './segments.js';
import { resolvePins } from '../model/rotate.js';
import { missingBreaks } from '../model/breaks.js';
import { isSurfaceMount, pinsRunOf, sideOf } from '../parts/library.js';
import { nets } from './derive.js';

const err = (code, message, refs = [], holes = []) =>
  ({ severity: 'error', code, message, refs, holes });
const warn = (code, message, refs = [], holes = []) =>
  ({ severity: 'warning', code, message, refs, holes });
const info = (code, message, refs = [], holes = []) =>
  ({ severity: 'info', code, message, refs, holes });

// EVERYTHING A RULE IS ALLOWED TO KNOW, worked out once. `segments` throws on a
// break that cannot be placed at all, and that throw belongs to the caller:
// there is no context to check anything against, so drc() turns it into
// bad-break and stops. An unresolvable placement is different — the rest of the
// board is still checkable — so it is remembered as pinError and the pins are
// empty.
export function drcContext(board, breaks = [], placements = [], getPart = null, wires = []) {
  const { cols, rows } = board;
  const segs = segments(board, breaks);
  let pins = [];
  let pinError = null;
  try { pins = resolvePins(placements, getPart); } catch (e) { pinError = e.message; }
  return {
    board,
    cols,
    rows,
    onBoard: (c, r) => c >= 0 && r >= 0 && c < cols && r < rows,
    breaks,
    placements,
    wires,
    getPart,
    segs,
    idx: segmentIndex(segs),
    pins,
    pinError,
  };
}

export const RULES = [
  {
    // Refs must be unique across placements AND wires.
    name: 'duplicate-refs',
    run: ({ placements, wires }) => {
      const out = [];
      const seenRef = new Map();
      for (const item of [...placements, ...wires]) {
        if (item.ref == null) continue;
        seenRef.set(item.ref, (seenRef.get(item.ref) ?? 0) + 1);
      }
      for (const [ref, n] of seenRef) {
        if (n > 1) out.push(err('duplicate-ref', `${ref} is used by ${n} items`, [ref]));
      }
      return out;
    },
  },
  {
    name: 'pins-on-the-board',
    run: ({ pins, onBoard, cols, rows }) => pins
      .filter((p) => !onBoard(p.col, p.row))
      .map((p) => err('pin-off-board',
        `${p.ref} pin ${p.pin} is at (${p.col},${p.row}), outside the ${cols}x${rows} board`,
        [p.ref], [{ col: p.col, row: p.row }])),
  },
  {
    // Two COMPONENT LEADS in one hole.
    //
    // Wire ends are deliberately excluded. A pen wire is soldered to the joint a
    // component lead already occupies — that is how a wiring pen is used, and
    // flagging it would put an error on every correctly built board.
    // A copper-side pad is soldered to the track underneath and never enters the
    // hole, so the hole stays free for a through-hole lead. Counting SMT pads here
    // would put a collision on every board that has a chip under a resistor.
    //
    // SURFACE-MOUNT, not "on the copper side": a DIP a placement has moved to the
    // copper side still has legs through its holes. See switchable-side.md.
    name: 'one-lead-per-hole',
    run: ({ pins, placements, getPart, onBoard }) => {
      const out = [];
      const surfaceRefs = new Set();
      for (const pl of placements) {
        try { if (isSurfaceMount(getPart(pl.part))) surfaceRefs.add(pl.ref); } catch { /* unknown part */ }
      }

      const leadAt = new Map();
      for (const p of pins) {
        if (!onBoard(p.col, p.row)) continue;
        if (surfaceRefs.has(p.ref)) continue;
        const k = holeKey(p.col, p.row);
        if (!leadAt.has(k)) leadAt.set(k, []);
        leadAt.get(k).push(p);
      }
      for (const [k, ps] of leadAt) {
        if (ps.length > 1) {
          const [col, row] = k.split(',').map(Number);
          out.push(err('hole-collision',
            `${ps.map((p) => `${p.ref}.${p.pin}`).join(' and ')} both occupy hole (${col},${row})`,
            ps.map((p) => p.ref), [{ col, row }]));
        }
      }
      return out;
    },
  },
  {
    name: 'wires',
    run: ({ wires, onBoard, cols, rows, idx }) => {
      const out = [];
      for (const w of wires) {
        if (!w.from || !w.to) {
          out.push(err('wire-malformed', `${w.ref} is missing an end`, [w.ref]));
          continue;
        }
        const okFrom = onBoard(w.from.col, w.from.row);
        const okTo = onBoard(w.to.col, w.to.row);
        if (!okFrom || !okTo) {
          out.push(err('wire-off-board',
            `${w.ref} runs to a hole outside the ${cols}x${rows} board`,
            [w.ref], [w.from, w.to]));
          continue;
        }
        if (w.from.col === w.to.col && w.from.row === w.to.row) {
          out.push(err('wire-degenerate',
            `${w.ref} starts and ends in hole (${w.from.col},${w.from.row})`,
            [w.ref], [w.from]));
          continue;
        }
        if (idx.get(holeKey(w.from.col, w.from.row)) === idx.get(holeKey(w.to.col, w.to.row))) {
          out.push(warn('wire-redundant',
            `${w.ref} joins two holes already on the same strip segment`,
            [w.ref], [w.from, w.to]));
        }
      }
      return out;
    },
  },
  {
    // Leads soldered into a spot-faced hole.
    //
    // A spot-face cutter removes the copper around its hole, so a lead there
    // connects to nothing. Sometimes that is deliberate — a leg that is only
    // mechanical support — so it warns rather than errors.
    name: 'leads-in-dead-holes',
    run: ({ pins, onBoard, idx }) => pins
      .filter((p) => p.electrical && onBoard(p.col, p.row) && !idx.get(holeKey(p.col, p.row)))
      .map((p) => warn('pin-on-dead-hole',
        `${p.ref} pin ${p.pin} sits in hole (${p.col},${p.row}), whose copper has been `
        + 'cut away — it connects to nothing',
        [p.ref], [{ col: p.col, row: p.row }])),
  },
  {
    name: 'shorts-across-a-part',
    run: ({ pins, placements, getPart, onBoard, idx }) => {
      const out = [];
      const byRef = new Map();
      for (const p of pins) {
        if (!p.electrical || !onBoard(p.col, p.row)) continue;
        if (!byRef.has(p.ref)) byRef.set(p.ref, []);
        byRef.get(p.ref).push(p);
      }
      for (const pl of placements) {
        let part;
        try { part = getPart(pl.part); } catch { continue; }
        const own = byRef.get(pl.ref) ?? [];
        const bySeg = new Map();
        for (const p of own) {
          const segId = idx.get(holeKey(p.col, p.row));
          if (!bySeg.has(segId)) bySeg.set(segId, []);
          bySeg.get(segId).push(p);
        }
        // A package that declares requiresBreak gets a finding that names the cut to
        // make. "U1 is shorted" and "you have not cut the strip under U1 between
        // holes 6 and 7" are different amounts of help.
        if (part.requiresBreak) {
          for (const b of missingBreaks(pl, getPart, idx)) {
            out.push(err('missing-required-break',
              `${pl.ref} needs the strip in row ${b.row} cut between holes ${b.x} and ${b.x + 1}`,
              [pl.ref], [{ col: b.x, row: b.row }, { col: b.x + 1, row: b.row }]));
          }
          continue;
        }

        for (const [, group] of bySeg) {
          if (group.length < 2) continue;
          const names = group.map((p) => p.pin).join(' and ');
          if (part.kind === 'link') {
            out.push(warn('link-redundant',
              `${pl.ref} joins ${names}, which are already on the same strip segment`,
              [pl.ref], group.map((p) => ({ col: p.col, row: p.row }))));
          } else {
            out.push(err('short-across-part',
              `${pl.ref} has ${names} on the same strip segment — the part is shorted out`,
              [pl.ref], group.map((p) => ({ col: p.col, row: p.row }))));
          }
        }
      }
      return out;
    },
  },
  {
    // Two bodies in one place.
    //
    // Two parts on the same side of the board whose pin rectangles share area
    // cannot both be built: a resistor over rows 4-9 and a capacitor over 6-8 in
    // one column passed every check, and was only ever avoided by reading
    // coordinates. The pin rectangle, not the drawn body, so it errs towards
    // missing an overlap rather than inventing one. Wire links are left out —
    // lying under a chip is what they are for. See docs/specs/body-overlap.md.
    name: 'bodies-in-one-place',
    run: ({ pins, placements, getPart }) => {
      const out = [];
      const rects = [];
      for (const pl of placements) {
        let part;
        try { part = getPart(pl.part); } catch { continue; }
        if (part.kind === 'link') continue;
        const own = pins.filter((p) => p.ref === pl.ref && p.electrical);
        if (!own.length) continue;
        rects.push({
          ref: pl.ref,
          side: sideOf(part, pl),
          c0: Math.min(...own.map((p) => p.col)),
          c1: Math.max(...own.map((p) => p.col)),
          r0: Math.min(...own.map((p) => p.row)),
          r1: Math.max(...own.map((p) => p.row)),
        });
      }
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          if (a.side !== b.side) continue;
          const c0 = Math.max(a.c0, b.c0);
          const c1 = Math.min(a.c1, b.c1);
          const r0 = Math.max(a.r0, b.r0);
          const r1 = Math.min(a.r1, b.r1);
          if (c0 > c1 || r0 > r1) continue;
          out.push(err('bodies-overlap',
            `${a.ref} and ${b.ref} are both on the ${a.side === 'copper' ? 'copper side' : 'top'} over row${r0 === r1 ? ` ${r0}` : `s ${r0}-${r1}`}, hole${c0 === c1 ? ` ${c0}` : `s ${c0}-${c1}`} — only one of them can be there`,
            [a.ref, b.ref], [{ col: c0, row: r0 }, { col: c1, row: r1 }]));
        }
      }
      return out;
    },
  },
  {
    // Which way the pins cross the strips.
    //
    // A part declares whether its pins run ACROSS the strips (each on its own) or
    // ALONG one (sharing it, with a cut). A placement turned the other way is
    // reported — as a WARNING, because a resistor laid along a strip over a cut
    // is a real technique, and an error would make a working board read as
    // broken. Pins 1 and 2 decide it, the same as the default rotation does.
    name: 'pins-across-the-strips',
    run: ({ pins, placements, getPart }) => {
      const out = [];
      for (const pl of placements) {
        let part;
        try { part = getPart(pl.part); } catch { continue; }
        const want = pinsRunOf(pl, part);
        // `either` is a real answer — an 0603 is built both ways — so it is never
        // turned the wrong way.
        if (want !== 'across' && want !== 'along') continue;
        const own = pins.filter((p) => p.ref === pl.ref && p.electrical);
        if (own.length < 2) continue;
        const alongNow = own[0].row === own[1].row;
        if (alongNow === (want === 'along')) continue;
        out.push(warn('pins-against-strips',
          want === 'across'
            ? `${pl.ref} has pins ${own[0].pin} and ${own[1].pin} on one strip, but its pins go across the strips — turn it a quarter turn`
            : `${pl.ref} has pins ${own[0].pin} and ${own[1].pin} on different strips, but its pins go along one strip — turn it a quarter turn`,
          [pl.ref], own.slice(0, 2).map((p) => ({ col: p.col, row: p.row }))));
      }
      return out;
    },
  },
  {
    // Off-grid pads.
    //
    // A SOT-23's pin 3 is drawn over the GAP between two holes on its strip (see
    // docs/specs/sot23-and-accepted-findings.md). Its connectivity hole is on the
    // grid, which is only honest while nothing lies in that gap — so the two
    // things that can lie there are reported rather than silently resolved to
    // whichever hole the model happened to pick.
    name: 'off-grid-pads',
    run: ({ pins, breaks }) => {
      const out = [];
      for (const p of pins) {
        const offCol = p.drawCol !== undefined && !Number.isInteger(p.drawCol);
        const offRow = p.drawRow !== undefined && !Number.isInteger(p.drawRow);
        if (offRow) {
          // Turned across the strips: the pad is on the gap BETWEEN two strips, and
          // its partners are on different strips 1.9 mm apart. Nothing about that
          // can be soldered.
          out.push(err('pad-between-strips',
            `${p.ref} pin ${p.pin} lands between two strips — turn it so its first two pins lie along one strip`,
            [p.ref], [{ col: p.col, row: p.row }]));
          continue;
        }
        if (!offCol) continue;
        const gap = Math.floor(p.drawCol);
        if (breaks.some((b) => b.at === 'gap' && b.row === p.row && b.x === gap)) {
          out.push(err('pad-over-cut',
            `${p.ref} pin ${p.pin} sits across the cut between holes ${gap} and ${gap + 1} in row ${p.row} — it joins whichever side the solder reaches`,
            [p.ref], [{ col: gap, row: p.row }, { col: gap + 1, row: p.row }]));
        }
      }
      return out;
    },
  },
  {
    name: 'what-each-segment-carries',
    run: ({ pins, placements, wires, getPart, onBoard, segs, idx }) => {
      const out = [];
      const usable = pins.filter((p) => p.electrical && onBoard(p.col, p.row));
      // nets() is called for its checking, not for its answer: it is the same
      // derivation the board is drawn from, and a board it cannot resolve should
      // fail here rather than in the renderer.
      const { segmentNet } = nets(segs, usable, placements, getPart, wires);
      void segmentNet;

      const countBySeg = new Map(segs.map((g) => [g.id, 0]));
      for (const p of usable) {
        const segId = idx.get(holeKey(p.col, p.row));
        countBySeg.set(segId, countBySeg.get(segId) + 1);
      }
      for (const w of wires) {
        if (!w.from || !w.to) continue;
        for (const hole of [w.from, w.to]) {
          if (!onBoard(hole.col, hole.row)) continue;
          const segId = idx.get(holeKey(hole.col, hole.row));
          countBySeg.set(segId, countBySeg.get(segId) + 1);
        }
      }

      for (const g of segs) {
        const n = countBySeg.get(g.id);
        if (n === 0) {
          out.push(info('segment-unused',
            `row ${g.row} holes ${g.x0}-${g.x1} carries nothing`, [], []));
        } else if (n === 1) {
          out.push(warn('pin-floating',
            `row ${g.row} holes ${g.x0}-${g.x1} has only one connection`, [], []));
        }
      }
      return out;
    },
  },
];

export function drc(board, breaks = [], placements = [], getPart = null, wires = []) {
  let ctx;
  try {
    ctx = drcContext(board, breaks, placements, getPart, wires);
  } catch (e) {
    return [err('bad-break', e.message)];
  }
  const out = [];
  if (ctx.pinError) out.push(err('bad-placement', ctx.pinError));
  for (const rule of RULES) out.push(...rule.run(ctx));
  return out;
}

export const errorsOnly = (findings) => findings.filter((d) => d.severity === 'error');
