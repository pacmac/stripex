// The status line must clear when there is nothing to say.
// Governed by docs/specs/break-hit-targets.md (found while verifying it)

import { suite, eq, ok, softImport } from '../run.mjs';

const here = import.meta.url;
const P = await softImport('../../src/render/panels.js', here);

const s = suite('status-line');

// The editor's rule for whether a message should replace the status line. It
// lives in panels.js so node can check it: the bug was that the editor tested
// the message for TRUTHINESS, and '' — meaning "clear the line" — is falsy, so
// deselecting left the line naming the thing you had just deselected.

s.check('AN EMPTY MESSAGE CLEARS THE LINE', () => {
  ok(P.shouldSetStatus(''), 'empty string is a message: clear it');
});

s.check('NO MESSAGE LEAVES THE LINE ALONE', () => {
  ok(!P.shouldSetStatus(undefined), 'undefined leaves it');
  ok(!P.shouldSetStatus(null), 'null leaves it');
});

s.check('an ordinary message replaces the line', () => {
  ok(P.shouldSetStatus('selected part U1'), 'a string');
  ok(P.shouldSetStatus('0'), 'even one that looks falsy as a number');
});

s.check('the distinction is presence, not truthiness', () => {
  // The whole bug in one check: '' and undefined are both falsy and must be
  // treated differently.
  ok(P.shouldSetStatus('') !== P.shouldSetStatus(undefined),
    'empty string and undefined differ');
});

process.exit((await s.run()) ? 0 : 1);
