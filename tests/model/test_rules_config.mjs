// The rules are configurable by the person they constrain.
// Governed by docs/specs/rules-are-configurable.md
//
// Peter: "this list will grow so it needs to be configurable." What he had was
// overridable-by-a-program: no control anywhere in the editor, and his own board
// carrying no rules key at all, so what governed it was whatever DEFAULT_RULES
// happened to say.
//
// THE CHECK THAT MATTERS IS THE FIRST ONE. Three checkboxes typed into the
// markup would satisfy today's three rules and would have to be typed again for
// the fourth — two lists that must agree with nothing checking that they do,
// which is the defect this project has already paid for twice. So the rules and
// their controls come from ONE list, and this asserts they cannot drift.

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const R = await softImport('../../src/model/rules.js', here);
const O = await softImport('../../src/model/ops.js', here);
const boardm = await softImport('../../src/model/board.js', here);

const s = suite('rules-config');

// Every rule id, including the dotted path into netClasses.
const ruleIds = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (
  (v && typeof v === 'object' && !Array.isArray(v))
    ? ruleIds(v, `${prefix}${k}.`)
    : [`${prefix}${k}`]
));

// ------------------------------------------------- the two lists are one

s.check('EVERY RULE HAS A DEFINITION AND EVERY DEFINITION IS A RULE', () => {
  ok(Array.isArray(R.RULE_DEFS), 'RULE_DEFS is a list');
  const defined = new Set(R.RULE_DEFS.map((d) => d.id));
  const actual = new Set(ruleIds(R.DEFAULT_RULES));

  const undescribed = [...actual].filter((id) => !defined.has(id));
  eq(undescribed, [], `rules with no definition, so no control: ${undescribed.join(', ')}`);

  const orphaned = [...defined].filter((id) => !actual.has(id));
  eq(orphaned, [], `definitions naming no rule: ${orphaned.join(', ')}`);
});

s.check('and every definition can be rendered without knowing what it is', () => {
  // The property that makes the card generic: a kind the panel can draw, a label
  // a person can read, and help that says what it does.
  for (const d of R.RULE_DEFS) {
    ok(['boolean', 'patterns'].includes(d.kind), `${d.id} has a drawable kind: ${d.kind}`);
    ok(d.label && d.label.length > 2, `${d.id} has a label`);
    ok(d.help && d.help.length > 10, `${d.id} says what it does`);
  }
});

// ------------------------------------------------- writing them

s.check('setRules WRITES A RULE ONTO THE BOARD', () => {
  const p = boardm.makeProject({ cols: 10, rows: 6 });
  const out = O.setRules(p, { penWiresFreeHolesOnly: false });
  ok(!out.error, `it applied: ${out.error ?? ''}`);
  eq(R.rulesFor(out.project).penWiresFreeHolesOnly, false, 'the rule is off');
  eq(R.rulesFor(p).penWiresFreeHolesOnly, true, 'and the board it was given is untouched');
});

s.check('and refuses a rule nobody has heard of, by name', () => {
  const p = boardm.makeProject({ cols: 10, rows: 6 });
  const out = O.setRules(p, { penWiresMustBeBlue: true });
  ok(out.error, 'it was refused');
  ok(/penWiresMustBeBlue/.test(out.error), `naming it: ${out.error}`);
});

s.check('and refuses a pattern that does not compile', () => {
  // A bad regex is caught and ignored at match time, so a stored one is a rule
  // that silently never fires. Refusing it at the door is the only place it can
  // still be reported to whoever typed it.
  const p = boardm.makeProject({ cols: 10, rows: 6 });
  const out = O.setRules(p, { netClasses: { power: ['^0V$', '^(unclosed'] } });
  ok(out.error, 'it was refused');
  ok(/unclosed/.test(out.error), `naming the pattern: ${out.error}`);
});

s.check('a board with no rules of its own still has rules', () => {
  const p = boardm.makeProject({ cols: 10, rows: 6 });
  ok(!('rules' in p) || p.rules == null, 'a fresh board stores none');
  eq(R.rulesFor(p).linksAreStraight, true, 'and reports the default');
});

// ------------------------------------------------- a rule that is off says so

s.check('A DISABLED RULE IS REPORTED, NOT SILENT', () => {
  // A constraint switched off six weeks ago is how a board gets built wrong by
  // someone who believes they are protected.
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  const off = O.setRules(p, { penWiresFreeHolesOnly: false }).project;
  const notes = R.disabledRuleNotes(off);
  ok(notes.length >= 1, 'a note is raised');
  ok(/penWiresFreeHolesOnly|hole to hole/i.test(JSON.stringify(notes)),
    `naming the rule: ${JSON.stringify(notes)}`);
  eq(R.disabledRuleNotes(p), [], 'and nothing is said when every rule is on');
});

s.check('and turning a rule off actually stops it refusing', () => {
  // The rule is data, so this is the whole mechanism end to end: the same wire,
  // refused under the default and allowed once the board says otherwise.
  const p = boardm.makeProject({ cols: 12, rows: 8 });
  p.placements.push({ ref: 'R1', part: 'res-axial', at: { col: 4, row: 2 }, rot: 0, span: 4 });

  const refused = O.addWire(p, { col: 9, row: 5 }, { col: 4, row: 2 });
  ok(refused.error, `refused by default: ${refused.error ?? 'it was not'}`);

  const off = O.setRules(p, { penWiresFreeHolesOnly: false }).project;
  const allowed = O.addWire(off, { col: 9, row: 5 }, { col: 4, row: 2 });
  ok(!allowed.error, `allowed once the rule is off: ${allowed.error ?? ''}`);
});

process.exit(await s.run() ? 0 : 1);
