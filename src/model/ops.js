// Every edit to a board, as a function.
//
// This exists because there was no way to build a board except by clicking one,
// so building Peter's rotator wiring meant three throwaway scripts in a scratch
// directory — each re-implementing hole-finding, occupancy and straightness, two
// of them wrongly, and the third with an off-by-one in a link's span that put
// its end on the wrong strip.
//
// THE SHAPE OF EVERY OPERATION IS THE SAME:
//
//   op(project, ...) -> { project, ref? }   it worked, here is a NEW board
//                    -> { error, code }     it did not, and here is which rule
//
// It never mutates what it is given, and it never returns a board that breaks
// the project's own rules. An operation that quietly produced a bad board would
// be a slower way of making the same mistakes.

import { makeProject, nextWireRef, nextPartRef, validateProject } from './board.js';
import { getPart, hasPart, isSurfaceMount, defaultRotOf, SIDES } from '../parts/library.js';
import { applyPlacementEdit } from './edit.js';
import { getDevice, placementFor } from '../parts/devices.js';
import { resolvePins, isRotation } from './rotate.js';
import { segments, segmentIndex, holeKey } from '../net/segments.js';
import { effectiveBreaks } from './breaks.js';
import { checkRules, rulesFor, netClassOf, validateRulePatch } from './rules.js';
import { netLabelsAllByNet, setNetLabel } from './nets.js';
import { nets as deriveNets } from '../net/derive.js';

const clone = (project) => JSON.parse(JSON.stringify(project));
const fail = (code, error) => ({ error, code });

const onBoard = (project, h) => Number.isInteger(h?.col) && Number.isInteger(h?.row)
  && h.col >= 0 && h.row >= 0
  && h.col < project.board.cols && h.row < project.board.rows;

// Which hole holds which pin. Surface-mount pads are excluded: they are soldered
// to the track and never enter the hole. That is the PART's fact, not which
// side the placement is on — a DIP on the copper side still fills its holes.
function pinsByHole(project) {
  const out = new Map();
  let pins = [];
  try { pins = resolvePins(project.placements ?? [], getPart); } catch { return out; }
  for (const p of pins) {
    let surface = false;
    try { surface = isSurfaceMount(getPart(project.placements.find((x) => x.ref === p.ref).part)); }
    catch { /* unknown part */ }
    if (surface) continue;
    out.set(`${p.col},${p.row}`, `${p.ref}.${p.pin}`);
  }
  return out;
}

function netsOf(project) {
  const segs = segments(project.board, effectiveBreaks(project));
  const pins = resolvePins(project.placements ?? [], getPart);
  return {
    segs,
    idx: segmentIndex(segs),
    ...deriveNets(segs, pins, project.placements ?? [], getPart, project.wires ?? []),
  };
}

// The names on the net a hole belongs to.
function namesAt(project, h) {
  const { idx, segmentNet } = netsOf(project);
  const segId = idx.get(holeKey(h.col, h.row));
  const netId = segId && segmentNet[segId];
  if (!netId) return [];
  const labels = netLabelsAllByNet(project, segmentNet);
  return (labels.get(netId) ?? []).map((l) => l.name).filter(Boolean);
}

// The holes a wire may land in, on the same strip as this pin.
//
// Written three times in three scratch scripts and wrong twice — once counting
// the pin's own hole as free, once excluding every column any part used anywhere
// rather than the ones actually in the way.
export function freeHolesOn(project, ref, pin) {
  const pins = resolvePins(project.placements ?? [], getPart);
  const p = pins.find((x) => x.ref === ref && String(x.pin) === String(pin));
  if (!p) return [];
  const segs = segments(project.board, effectiveBreaks(project));
  const seg = segs.find((g) => g.row === p.row && p.col >= g.x0 && p.col <= g.x1);
  if (!seg) return [];
  const taken = pinsByHole(project);
  for (const w of project.wires ?? []) {
    taken.set(`${w.from.col},${w.from.row}`, w.ref);
    taken.set(`${w.to.col},${w.to.row}`, w.ref);
  }
  const out = [];
  for (let c = seg.x0; c <= seg.x1; c += 1) {
    if (taken.has(`${c},${seg.row}`)) continue;
    out.push({ col: c, row: seg.row });
  }
  return out;
}

// ------------------------------------------------------------------ parts

export function addPart(project, { part, at, rot: asked, span, width, device, silk, value, side } = {}) {
  if (!onBoard(project, at)) return fail('off-board', `(${at?.col},${at?.row}) is not on this board`);
  if (side != null && !SIDES.includes(side)) {
    return fail('bad-side', `${JSON.stringify(side)} is not a side — "top" or "copper"`);
  }
  // NO ROTATION GIVEN means the one the part declares, not 0. At 0 every part in
  // the catalogue lies with its pins along one strip. An explicit rot is always
  // honoured. See docs/specs/pins-run-across-strips.md.
  let rot = asked;
  if (rot == null) {
    const d = device ? getDevice(device) : null;
    const base = d ? d.base : part;
    rot = hasPart(base) ? defaultRotOf(getPart(base), d?.pinsRun ?? getPart(base).pinsRun) : 0;
  }
  if (!isRotation(rot)) return fail('bad-rotation', `${rot} is not a rotation`);

  // A DEVICE BRINGS ITS OWN EVERYTHING. placementFor copies its span, width,
  // silk, cut setting and PIN NAMES onto the placement — which is the whole
  // point of the catalogue, and was being skipped: `device` was carried as a tag
  // and a XIAO placed through the API came back as a bare DIP, span 7 width 3
  // with no names at all. A chip of the wrong size with numbered pins is exactly
  // what the catalogue exists to prevent.
  if (device) {
    const d = getDevice(device);
    if (!d) return fail('no-such-device', `${JSON.stringify(device)} is not a device`);
    const next = clone(project);
    const pl = placementFor(device, { col: at.col, row: at.row }, rot,
      nextPartRef(next, d.base));
    if (!pl) return fail('no-such-device', `${JSON.stringify(device)} could not be placed`);
    if (silk) pl.silk = silk;
    if (value) pl.value = value;
    if (side) pl.side = side;       // over the device's own, when asked for
    next.placements.push(pl);
    const bad = validateProject(next);
    if (bad.length) return fail('invalid', bad[0].message);
    return { project: next, ref: pl.ref };
  }

  if (!hasPart(part)) return fail('no-such-part', `${JSON.stringify(part)} is not in the library`);
  const next = clone(project);
  const def = getPart(part);
  const pl = { ref: nextPartRef(next, part), part, at: { col: at.col, row: at.row }, rot };
  if (def.parametric && span != null) pl.span = span;
  else if (def.parametric) pl.span = def.defaultSpan ?? 1;
  if (def.defaultWidth != null) pl.width = width ?? def.defaultWidth;
  if (silk) pl.silk = silk;
  if (value) pl.value = value;
  if (side) pl.side = side;
  next.placements.push(pl);
  const bad = validateProject(next);
  if (bad.length) return fail('invalid', bad[0].message);
  return { project: next, ref: pl.ref };
}

// Move a placed part to the other side of the board. Through the same edit the
// Focus panel uses, so the API and the mouse cannot disagree about what is legal.
export function setSide(project, ref, side) {
  const i = (project.placements ?? []).findIndex((x) => x.ref === ref);
  if (i < 0) return fail('no-such-ref', `${JSON.stringify(ref)} is not on this board`);
  const { placement, error } = applyPlacementEdit(project.placements[i], getPart, 'side', side);
  if (error) return fail('bad-side', error);
  const next = clone(project);
  next.placements[i] = placement;
  return { project: next, ref };
}

export function removePart(project, ref) {
  if (!(project.placements ?? []).some((x) => x.ref === ref)) {
    return fail('no-such-part', `there is no ${ref} on this board`);
  }
  const next = clone(project);
  next.placements = next.placements.filter((x) => x.ref !== ref);
  return { project: next, ref };
}

export function movePart(project, ref, pin, to) {
  const pl = (project.placements ?? []).find((x) => x.ref === ref);
  if (!pl) return fail('no-such-part', `there is no ${ref} on this board`);
  if (!onBoard(project, to)) return fail('off-board', `(${to?.col},${to?.row}) is not on this board`);
  const pins = resolvePins([pl], getPart);
  const held = pins.find((x) => String(x.pin) === String(pin));
  if (!held) return fail('no-such-pin', `${ref} has no pin ${pin}`);
  const next = clone(project);
  const target = next.placements.find((x) => x.ref === ref);
  target.at = { col: target.at.col + (to.col - held.col), row: target.at.row + (to.row - held.row) };
  const bad = validateProject(next);
  if (bad.length) return fail('invalid', bad[0].message);
  return { project: next, ref };
}

// ------------------------------------------------------------------ wires

// `warnOnly` names the rules that should REPORT rather than refuse.
//
// The editor passes `['penWiresSignalsOnly']`: Peter's own board carries pen
// wires drawn before that rule existed, and a rule that makes an existing board
// unusable is a rule nobody keeps. The API passes nothing and refuses
// everything, because a planner building a board unattended must be held to it.
// The person at the bench outranks a design preference; a script does not.
export function addWire(project, from, to, { warnOnly = [] } = {}) {
  for (const [what, h] of [['from', from], ['to', to]]) {
    if (!onBoard(project, h)) return fail('off-board', `the ${what} hole is not on this board`);
  }
  if (from.col === to.col && from.row === to.row) {
    return fail('same-hole', 'a wire needs two different holes');
  }
  const rules = rulesFor(project);

  // HOLE TO HOLE. Peter: "point to point must be hole to hole and not hole with
  // pin already in it to another hole." I did the opposite nine times.
  if (rules.penWiresFreeHolesOnly) {
    const occupied = pinsByHole(project);
    for (const h of [from, to]) {
      const who = occupied.get(`${h.col},${h.row}`);
      if (who) {
        return fail('pen-wire-on-a-pin',
          `(${h.col},${h.row}) already has ${who} in it — a pen wire goes hole to hole`);
      }
    }
  }

  // SIGNALS ONLY. Peter: "power lines must be wire links."
  if (rules.penWiresSignalsOnly && !warnOnly.includes('penWiresSignalsOnly')) {
    for (const h of [from, to]) {
      const power = namesAt(project, h).find((nm) => netClassOf(nm, rules) === 'power');
      if (power) {
        return fail('pen-wire-on-power',
          `(${h.col},${h.row}) is on ${power}, a power net — use a wire link for power`);
      }
    }
  }

  const next = clone(project);
  const ref = nextWireRef(next);
  next.wires.push({ ref, from: { col: from.col, row: from.row }, to: { col: to.col, row: to.row } });
  return { project: next, ref };
}

export function removeWire(project, ref) {
  if (!(project.wires ?? []).some((x) => x.ref === ref)) {
    return fail('no-such-wire', `there is no wire ${ref} on this board`);
  }
  const next = clone(project);
  next.wires = next.wires.filter((x) => x.ref !== ref);
  return { project: next, ref };
}

// A link between two holes, with the rotation and span DERIVED.
//
// A link's span is the DISTANCE between its ends, not the number of holes it
// covers. Getting that wrong by one put a link's end on the wrong strip, and it
// is exactly the arithmetic no caller should ever do again.
export function addLink(project, from, to, { part = 'wire-link', silk } = {}) {
  for (const [what, h] of [['from', from], ['to', to]]) {
    if (!onBoard(project, h)) return fail('off-board', `the ${what} hole is not on this board`);
  }
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc === 0 && dr === 0) return fail('same-hole', 'a link needs two different holes');
  if (dc !== 0 && dr !== 0) {
    return fail('link-not-straight',
      `(${from.col},${from.row}) to (${to.col},${to.row}) is neither along a strip nor `
      + 'across one — a wire link is straight');
  }
  const span = Math.abs(dc || dr);
  const rot = dc !== 0 ? 0 : 90;
  const at = { col: Math.min(from.col, to.col), row: Math.min(from.row, to.row) };
  const next = clone(project);
  const ref = nextPartRef(next, part);
  const pl = { ref, part, at, rot, span };
  if (silk) pl.silk = silk;
  next.placements.push(pl);
  const bad = validateProject(next);
  if (bad.length) return fail('invalid', bad[0].message);
  return { project: next, ref };
}

// ------------------------------------------------------------------ copper

export function setBreak(project, { row, x, at = 'gap' } = {}) {
  if (!['gap', 'hole'].includes(at)) return fail('bad-cut', `${at} is not a kind of cut`);
  const maxX = at === 'hole' ? project.board.cols - 1 : project.board.cols - 2;
  if (!Number.isInteger(row) || row < 0 || row >= project.board.rows) {
    return fail('off-board', `row ${row} is not on this board`);
  }
  if (!Number.isInteger(x) || x < 0 || x > maxX) {
    return fail('off-board', `${at} cut at x=${x} is outside 0..${maxX}`);
  }
  const next = clone(project);
  next.breaks = next.breaks.filter((b) => !(b.row === row && b.x === x));
  next.breaks.push({ row, x, at });
  return { project: next };
}

export function clearBreak(project, { row, x } = {}) {
  const had = (project.breaks ?? []).some((b) => b.row === row && b.x === x);
  if (!had) return fail('no-such-cut', `there is no cut at row ${row}, x ${x}`);
  const next = clone(project);
  next.breaks = next.breaks.filter((b) => !(b.row === row && b.x === x));
  return { project: next };
}

export function setLabel(project, hole, { name, colour } = {}) {
  if (!onBoard(project, hole)) return fail('off-board', `(${hole?.col},${hole?.row}) is not on this board`);
  // A name belongs to a net, and a hole with no strip under it belongs to none —
  // a spot-faced hole is the case that matters.
  const { idx, segmentNet } = netsOf(project);
  const segId = idx.get(holeKey(hole.col, hole.row));
  if (!segId || !segmentNet[segId]) {
    return fail('dead-hole', `(${hole.col},${hole.row}) is on no net — a name there would name nothing`);
  }
  return { project: setNetLabel(clone(project), hole, name || colour ? { name, colour } : null) };
}

// A footprint that was always a chip, told which chip it is.
//
// Peter's own TMC2209 and XIAO are `part: "dip"` with no device and no pin
// names, drawn before the catalogue existed; his net names were placed by eye on
// the strips. Without this, a netlist saying `U2.STEP` could never address the
// only real board in the project — the feature would be born unable to touch it.
//
// REFUSED WHEN THE PIN COUNT DIFFERS. An adoption that silently renumbered pins
// would corrupt a board rather than describe it, and every name after the
// mismatch would be confidently wrong.
export function adoptDevice(project, ref, device) {
  const pl = (project.placements ?? []).find((x) => x.ref === ref);
  if (!pl) return fail('no-such-part', `there is no ${ref} on this board`);
  const d = getDevice(device);
  if (!d) return fail('no-such-device', `${JSON.stringify(device)} is not a device`);

  const have = countPins(pl);
  const want = d.pins?.length ?? 0;
  if (have !== want) {
    return fail('wrong-pin-count',
      `${ref} is a ${have}-pin footprint and a ${d.name} has ${want} pins`);
  }

  const next = clone(project);
  const target = next.placements.find((x) => x.ref === ref);
  // The catalogue is COPIED ON, exactly as placementFor does it — a placement
  // owes the catalogue nothing afterwards. What the board already says about
  // where it sits and which way round it goes is left alone: this says what the
  // part IS, not where it is.
  target.device = d.id;
  if (d.pins?.length) target.pinNames = [...d.pins];
  if (d.silk && !target.silk) target.silk = d.silk;
  if (d.unverifiedPins?.length) target.unverifiedPins = [...d.unverifiedPins];
  if (d.pinSource) target.pinSource = d.pinSource;

  const bad = validateProject(next);
  if (bad.length) return fail('invalid', bad[0].message);
  return { project: next, ref };
}

// --------------------------------------------------------------- pin names

// The names on ONE placement, replaced.
//
// A placement copies the catalogue and owes it nothing, which is exactly what
// makes this safe: a board may know better than the library. It is the mechanism
// by which reading a silkscreen becomes part of a board rather than a remark in
// a chat log — the TMC2209's NC3 and NC4 are unverified because two web sources
// describe different modules, and only the part in someone's hand settles it.
//
// SETTING A NAME CLEARS ITS DOUBT. A name typed by a person looking at the part
// is better sourced than anything in the catalogue, so the flag comes off; a
// name they did not touch keeps whatever it had.
export function setPinNames(project, ref, names) {
  const pl = (project.placements ?? []).find((x) => x.ref === ref);
  if (!pl) return fail('no-such-part', `there is no ${ref} on this board`);
  if (!Array.isArray(names)) return fail('bad-names', 'pin names come as a list');
  const want = pl.pinNames?.length ?? countPins(pl);
  if (names.length !== want) {
    return fail('wrong-pin-count',
      `${ref} has ${want} pins and ${names.length} ${names.length === 1 ? 'name was' : 'names were'} given`);
  }
  const blank = names.findIndex((x) => !String(x ?? '').trim());
  if (blank >= 0) return fail('blank-name', `pin ${blank + 1} was given no name`);

  const next = clone(project);
  const target = next.placements.find((x) => x.ref === ref);
  const before = target.pinNames ?? [];
  target.pinNames = names.map((x) => String(x).trim());
  // Recomputed only where doubt was recorded in the first place, and kept as an
  // empty list rather than deleted: "these names were flagged and someone
  // settled them" is a different fact from "nobody ever wondered", and the
  // second must not be able to masquerade as the first.
  if (target.unverifiedPins) {
    target.unverifiedPins = target.unverifiedPins.filter((name) => {
      const i = before.indexOf(name);
      return i >= 0 && target.pinNames[i] === name;      // untouched, so still doubtful
    });
  }
  const bad = validateProject(next);
  if (bad.length) return fail('invalid', bad[0].message);
  return { project: next, ref };
}

// How many pins a placement has, for a footprint with no names on it yet.
function countPins(pl) {
  try { return resolvePins([pl], getPart).length; } catch { return 0; }
}

// ------------------------------------------------------------------ board

// Change the outline, keeping everything on it.
//
// There was no way to do this at all: making a board narrower meant deleting it
// and rebuilding it from its ops, which I did three times on one board — losing
// its identity, its history and its name each round.
//
// IT REFUSES RATHER THAN TRUNCATES, and names what would be stranded. Silently
// dropping a part that no longer fits is the one behaviour worse than refusing,
// because a board with a lead half over the edge still looks plausible. Growing
// is never refused: nothing can fall off a bigger board.
export function setBoardSize(project, { cols, rows } = {}) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    return fail('bad-size', `${JSON.stringify({ cols, rows })} is not a board size`);
  }
  if (cols < 2 || rows < 2) {
    return fail('bad-size', `${cols} x ${rows} is too small to be a board`);
  }

  const next = clone(project);
  next.board = { ...next.board, cols, rows };

  const off = [];
  const outside = (col, row) => col < 0 || row < 0 || col >= cols || row >= rows;

  let pins = [];
  try { pins = resolvePins(next.placements ?? [], getPart); } catch { /* validate reports it */ }
  for (const p of pins) {
    if (outside(p.col, p.row)) off.push(`${p.ref} pin ${p.pin}`);
  }
  for (const w of next.wires ?? []) {
    for (const [end, h] of [['from', w.from], ['to', w.to]]) {
      if (h && outside(h.col, h.row)) off.push(`wire ${w.ref} (${end})`);
    }
  }
  for (const b of next.breaks ?? []) {
    // A gap cut lives between hole x and x+1, so the last legal one is cols-2.
    const maxX = (b.at ?? 'gap') === 'hole' ? cols - 1 : cols - 2;
    if (b.row >= rows || b.x > maxX) off.push(`the cut at row ${b.row}, x ${b.x}`);
  }
  for (const key of Object.keys(next.netLabels ?? {})) {
    const m = /^(-?\d+),(-?\d+)$/.exec(key);
    if (!m) continue;
    if (outside(Number(m[1]), Number(m[2]))) {
      off.push(`the name ${JSON.stringify(next.netLabels[key]?.name ?? key)} at ${key}`);
    }
  }

  if (off.length) {
    const seen = [...new Set(off)];
    return fail('would-not-fit',
      `${cols} x ${rows} would leave ${seen.length === 1 ? 'this' : 'these'} off the board: `
      + `${seen.slice(0, 6).join(', ')}${seen.length > 6 ? ` and ${seen.length - 6} more` : ''}`);
  }

  const bad = validateProject(next);
  if (bad.length) return fail('invalid', bad[0].message);
  return { project: next };
}

// ------------------------------------------------------------------ rules

// Change the rules this BOARD is built under.
//
// Peter: "this list will grow so it needs to be configurable." The patch is
// validated against RULE_DEFS rather than merged blindly: a rule id nobody has
// heard of is a typo that would sit in the file for ever doing nothing, and a
// pattern that does not compile is a rule that silently never fires — both are
// refused here, where whoever typed them is still listening.
//
// netClasses is merged one class at a time so a caller can replace `power`
// without having to restate every other class it does not care about.
export function setRules(project, patch = {}) {
  const bad = validateRulePatch(patch);
  if (bad) return fail('bad-rule', bad);
  const next = clone(project);
  const current = next.rules ?? {};
  const merged = { ...current, ...patch };
  if (patch.netClasses) {
    merged.netClasses = { ...(current.netClasses ?? {}), ...patch.netClasses };
  }
  next.rules = merged;
  return { project: next };
}

// --------------------------------------------------------------- the batch

const OPS = {
  setBoardSize: (p, a) => setBoardSize(p, a),
  setRules: (p, a) => setRules(p, a.rules ?? a.patch ?? {}),
  setPinNames: (p, a) => setPinNames(p, a.ref, a.names),
  adoptDevice: (p, a) => adoptDevice(p, a.ref, a.device),
  addPart: (p, a) => addPart(p, a),
  removePart: (p, a) => removePart(p, a.ref),
  setSide: (p, a) => setSide(p, a.ref, a.side),
  movePart: (p, a) => movePart(p, a.ref, a.pin, a.to),
  addWire: (p, a) => addWire(p, a.from, a.to),
  removeWire: (p, a) => removeWire(p, a.ref),
  addLink: (p, a) => addLink(p, a.from, a.to, a),
  setBreak: (p, a) => setBreak(p, a),
  clearBreak: (p, a) => clearBreak(p, a),
  setLabel: (p, a) => setLabel(p, a.hole, a),
};

export const OP_NAMES = Object.keys(OPS);

// Apply a list of operations IN ORDER, ALL OR NOTHING.
//
// The first refusal aborts and the board handed in is what comes back, so a
// half-applied batch cannot exist. `index` says which one stopped it.
export function applyOps(project, ops = []) {
  let cur = project;
  const refs = [];
  for (const [i, op] of ops.entries()) {
    const fn = OPS[op?.op];
    if (!fn) return { error: `${JSON.stringify(op?.op)} is not an operation`, code: 'no-such-op', index: i };
    const r = fn(cur, op);
    if (r.error) return { ...r, index: i };
    cur = r.project;
    if (r.ref) refs.push(r.ref);
  }
  return { project: cur, refs };
}

export { checkRules, makeProject };
