// The left panel is cards that own their settings.
// Governed by docs/specs/left-panel-cards.md

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const P = await softImport('../../src/render/panels.js', here);
const cur = await softImport('../../src/render/cursors.js', here);
const lib = await softImport('../../src/parts/library.js', here);

const s = suite('cards');

s.check('THE CARDS EXIST, IN ORDER', () => {
  // Cutting has GONE. Peter: "I want 2 buttons and remove the cutting section
  // from the left panel." A card holding one either/or setting was a panel you
  // had to open to change a thing you change constantly; two buttons in the
  // toolbar say which is armed without being opened.
  // RULES sits between the view concern and the document concern, because that
  // is what it is: what this board is built under. Peter: "this list will grow
  // so it needs to be configurable."
  eq(P.CARDS.map((c) => c.id), ['library', 'layers', 'rules', 'board'], 'card ids');
  for (const c of P.CARDS) {
    ok(c.title, `${c.id} has a title`);
    ok(c.icon, `${c.id} has an icon`);
  }
});

s.check('A TOOL OPENS THE CARD THAT HOLDS ITS SETTINGS', () => {
  eq(P.cardForTool('place'), 'library', 'place opens the library');
  eq(P.cardForTool('wire'), 'library', 'so does wire — it picks a part too');
  eq(P.cardForTool('break'), null, 'break has no card to open any more');
});

s.check('LAYERS AND BOARD NEVER OPEN THEMSELVES', () => {
  // They are view and document concerns, not any tool's settings. Opening them
  // on a tool change would move the panel for no reason.
  for (const tool of Object.keys(cur.CURSORS)) {
    ok(P.cardForTool(tool) !== 'layers', `${tool} does not open layers`);
    ok(P.cardForTool(tool) !== 'board', `${tool} does not open board`);
  }
});

s.check('the tools that configure nothing open nothing', () => {
  eq(P.cardForTool('select'), null, 'select');
  eq(P.cardForTool('move'), null, 'move');
  eq(P.cardForTool('delete'), null, 'delete');
});

s.check('every tool has an answer, even an unknown one', () => {
  for (const tool of [...Object.keys(cur.CURSORS), 'nonsense', '', null]) {
    const c = P.cardForTool(tool);
    ok(c === null || P.CARDS.some((x) => x.id === c), `${tool} -> ${c}`);
  }
});

s.check('EVERY CARD A TOOL CAN OPEN ACTUALLY EXISTS', () => {
  const ids = new Set(P.CARDS.map((c) => c.id));
  for (const tool of Object.keys(cur.CURSORS)) {
    const c = P.cardForTool(tool);
    if (c) ok(ids.has(c), `${tool} opens ${c}, which exists`);
  }
});

// ------------------------------------------- which parameters a part offers

s.check('A PART OFFERS ONLY THE PARAMETERS IT HAS', () => {
  // The complaint: span and width sat in the panel whether or not the chosen
  // part used them.
  eq(P.paramsFor(lib.getPart('dip')).map((f) => f.field), ['span', 'width'], 'a DIP');
  eq(P.paramsFor(lib.getPart('res-axial')).map((f) => f.field), ['span'], 'a resistor');
  eq(P.paramsFor(lib.getPart('led')), [], 'an LED has none');
  eq(P.paramsFor(lib.getPart('to220')), [], 'nor a TO-220');
  eq(P.paramsFor(lib.getPart('point-to-point')), [], 'nor point to point — it is drawn');
});

s.check('each parameter carries what the control needs', () => {
  for (const f of P.paramsFor(lib.getPart('dip'))) {
    ok(f.label, `${f.field} has a label`);
    ok(Number.isInteger(f.min), `${f.field} has a minimum`);
    ok(Number.isInteger(f.value), `${f.field} has a default`);
  }
});

s.check('a part with no parameters shows nothing, not disabled boxes', () => {
  eq(P.paramsFor(lib.getPart('mount-hole')).length, 0, 'none');
});

// --------------------------------------------------------- library grouping

s.check('THE LIBRARY GROUPS BY CATEGORY, IN THE DECLARED ORDER', () => {
  const groups = P.groupParts(lib.partList(), lib.CATEGORIES);
  ok(groups.length > 1, `${groups.length} groups`);
  const order = lib.CATEGORIES.map((c) => c.id);
  eq(groups.map((g) => g.id), order.filter((id) => groups.some((g) => g.id === id)),
    'in CATEGORIES order');
  const total = groups.reduce((n, g) => n + g.parts.length, 0);
  eq(total, lib.partList().length, 'and every part lands in exactly one');
});

s.check('SEARCH FILTERS BY NAME AND BY ID', () => {
  // Useless at fourteen, essential at sixty, and it cannot be bolted onto a list
  // that has grown a different shape.
  const all = lib.partList();
  eq(P.filterParts(all, '').length, all.length, 'empty search shows everything');
  ok(P.filterParts(all, 'resistor').some((p) => p.id === 'res-axial'), 'by name');
  ok(P.filterParts(all, 'dip').some((p) => p.id === 'dip'), 'by id');
  ok(P.filterParts(all, 'RESISTOR').length > 0, 'case insensitively');
  eq(P.filterParts(all, 'zzzznothing'), [], 'and finds nothing when there is nothing');
});

s.check('a filtered library still groups', () => {
  const groups = P.groupParts(P.filterParts(lib.partList(), 'cap'), lib.CATEGORIES);
  ok(groups.length >= 1, 'at least one group');
  ok(groups.every((g) => g.parts.length > 0), 'and no empty groups are shown');
});

process.exit((await s.run()) ? 0 : 1);
