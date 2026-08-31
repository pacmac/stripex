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

s.check('PERSIST DOES NOT WRITE THE BOARD TO THE BROWSER AT ALL', () => {
  // This used to check that a full localStorage was REPORTED rather than
  // swallowed, because the board was cached there and a silent quota error meant
  // edits vanished. The board is no longer written to the browser: it goes to
  // the server, which reports its own failures. There is nothing left to fill.
  //
  // The defect that check was written for cannot recur, because the write is
  // gone — so the check now guards the absence instead of the error handling.
  const body = /function persist\(\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1];
  ok(body, 'persist() is found');
  ok(!/localStorage\.setItem/.test(body), `it writes no board to the browser: ${body}`);
  ok(/scheduleSave\(\)/.test(body), 'and sends the edit to the server');
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
