// Two defects fixed long before anything could check them.
// Governed by docs/specs/never-lose-a-board.md and docs/specs/colour-and-escape.md
//
// Both were repaired in the source and left `untried` in the register, which
// means the fix is real and the EVIDENCE is not: nothing anywhere would notice
// if either came back. These are the checks that were missing, written against
// the behaviour rather than against the diff.

import { readFileSync } from 'node:fs';
import { suite, eq, ok, softImport } from '../run.mjs';

const P = await softImport('../../src/render/panels.js', import.meta.url);
const K = await softImport('../../src/render/keys.js', import.meta.url);
const src = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');

const s = suite('persist-and-escape');

// ------------------------------------------------- a full store says so

s.check('PERSIST REPORTS A FULL STORE RATHER THAN SWALLOWING IT', () => {
  // It caught the quota error with an empty catch, so once storage filled every
  // later edit was silently not saved and you found out on reload. The board is
  // the one thing in this project that must never fail quietly.
  const body = /function persist\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  ok(body, 'persist() is found');
  ok(/catch\s*\([\s\S]{0,400}?banner\(/.test(body),
    'the catch around the board write raises a banner');
  ok(/NOT SAVED/i.test(body), 'and the banner says the work is not saved');
  ok(!/catch\s*\(\w*\)\s*\{\s*\}/.test(body), 'no empty catch is left in it');
});

s.check('and it returns whether it actually wrote', () => {
  // A caller that cannot tell is a caller that carries on regardless.
  const body = /function persist\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  ok(/return ok;/.test(body), 'persist returns its result');
});

s.check('the history is expendable and the board is not', () => {
  // pushSnapshot drops its own oldest entries until it fits rather than
  // touching the board, and its failure must not look like the board failing.
  const body = /function persist\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  const snap = /pushSnapshot\([\s\S]{0,120}/.exec(body)?.[0] ?? '';
  ok(/catch/.test(snap), `the snapshot write has its own catch: ${snap.slice(0, 80)}`);
});

// ------------------------------------- escape does not leave a part lit

s.check('ESCAPE ARMS SELECT', () => {
  eq(K.TOOL_AFTER_ESCAPE, 'select', 'the tool Escape returns to');
  const tools = new Set(Object.values(K.TOOL_KEYS));
  ok(tools.has(K.TOOL_AFTER_ESCAPE), 'and it is a tool the toolbar can arm');
});

s.check('AND THE PALETTE IS TOLD, SO NOTHING IS LEFT LIT', () => {
  // Escape switched the tool and the palette still showed a part highlighted, so
  // the board looked armed for placing while Select was actually active. Two
  // pieces of state saying different things, which is the shape this project has
  // paid for repeatedly.
  //
  // markPaletteArmed is called from setTool — the ONE place the armed tool
  // changes — so the palette cannot drift from the toolbar whatever route the
  // change arrives by.
  const body = /function setTool\(tool\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  ok(body, 'setTool is found');
  ok(/markPaletteArmed\(\)/.test(body), 'setTool tells the palette');

  const marker = /function markPaletteArmed\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  ok(marker, 'markPaletteArmed exists');
  ok(/armed/.test(marker), 'and it turns the highlight on or off by the armed tool');
});

s.check('escape goes through setTool rather than setting the tool itself', () => {
  // Setting state.tool directly would skip the palette, the cursor and the card.
  const handler = /if \(e\.key === 'Escape'\)\s*\{([\s\S]*?)\n\s{4}\}/.exec(src)?.[1];
  ok(handler, 'the Escape branch is found');
  ok(/setTool\(TOOL_AFTER_ESCAPE\)/.test(handler),
    `it calls setTool: ${String(handler).trim().slice(0, 120)}`);
  ok(/state\.selection = null/.test(handler), 'and clears the selection');
});

s.check('the tool a place-like part arms still opens its card', () => {
  // A control: the card rules are unchanged by any of this.
  eq(P.cardForTool('place'), 'library', 'place opens the library');
  eq(P.cardForTool('select'), null, 'select opens nothing');
});

process.exit((await s.run()) ? 0 : 1);
