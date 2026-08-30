// Boards as files on disk, with names, and a guard against two writers.
// Governed by docs/specs/boards-on-the-server.md

import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, eq, ok, softImport } from '../run.mjs';

const B = await softImport('../../src/server/boards.js', import.meta.url);

const s = suite('boards');

const fresh = () => mkdtempSync(join(tmpdir(), 'stripex-boards-'));
const board = (name = 'test') => ({
  schema: 'stripex/1',
  name,
  board: { cols: 25, rows: 20, pattern: 'strip' },
  breaks: [],
  placements: [],
  wires: [],
});

// ------------------------------------------------- the slug is a whitelist

s.check('A SLUG THAT ESCAPES THE DIRECTORY IS REFUSED', () => {
  // This is the one place in this project where getting it wrong hands out the
  // whole disk: a piece of URL becomes a filesystem path.
  const dir = fresh();
  for (const bad of ['..', '../..', '../../etc/passwd', '/etc/passwd', 'a/../../b',
    'a/b', './x', '', ' ', 'x\0y', 'C:\\x', '-leading', 'UPPER', 'x'.repeat(65)]) {
    let threw = null;
    try { B.read(dir, bad); } catch (e) { threw = e.code; }
    ok(threw === 'bad-slug', `${JSON.stringify(bad)} refused, got ${threw}`);
  }
});

s.check('and a refused slug never reaches the filesystem', () => {
  const dir = fresh();
  try { B.write(dir, '../escape', board(), null); } catch { /* expected */ }
  eq(readdirSync(dir), [], 'nothing was created anywhere near it');
});

s.check('isSlug accepts what a board is actually called', () => {
  for (const good of ['a', 'x1', 'tmc2209-driver', 'my_board', 'board-2']) {
    ok(B.isSlug(good), good);
  }
});

s.check('SLUGFOR TURNS A NAME INTO A FILENAME', () => {
  eq(B.slugFor('TMC2209 driver board'), 'tmc2209-driver-board', 'words joined');
  eq(B.slugFor('  Spaced   Out  '), 'spaced-out', 'runs collapse and ends trim');
  eq(B.slugFor('Peter’s board'), 'peters-board', 'an apostrophe does not split a word');
  eq(B.slugFor('A/B: test!'), 'a-b-test', 'punctuation goes');
});

s.check('and refuses a name with nothing usable in it', () => {
  for (const bad of ['', '   ', '!!!', '---', null, undefined]) {
    eq(B.slugFor(bad), null, `${JSON.stringify(bad)} has no slug`);
  }
});

// ------------------------------------------------------- write and read back

s.check('A BOARD WRITTEN COMES BACK IDENTICALLY', () => {
  const dir = fresh();
  const p = board('First');
  p.placements.push({ ref: 'R1', part: 'res-axial', at: { col: 2, row: 2 }, rot: 0, span: 4 });
  const { version } = B.write(dir, 'first', p, null);
  ok(version, 'a version comes back');
  const back = B.read(dir, 'first');
  eq(back.project, p, 'the same board');
  eq(back.version, version, 'and the same version');
});

s.check('the version changes when the board does', () => {
  const dir = fresh();
  const a = B.write(dir, 'x', board('X'), null);
  const b = B.write(dir, 'x', { ...board('X'), name: 'X2' }, a.version);
  ok(a.version !== b.version, `${a.version} -> ${b.version}`);
});

s.check('reading a board that is not there says so', () => {
  let code = null;
  try { B.read(fresh(), 'nope'); } catch (e) { code = e.code; }
  eq(code, 'no-such-board', 'named, not a crash');
});

// --------------------------------------------------- two writers, one board

s.check('A STALE WRITE IS REFUSED AND CHANGES NOTHING', () => {
  // The case this exists for: I edit boards/x.json by hand while the editor has
  // it open, and its next autosave would erase my change without either of us
  // knowing.
  const dir = fresh();
  const first = B.write(dir, 'x', board('X'), null);
  // somebody else writes
  B.write(dir, 'x', { ...board('X'), name: 'edited elsewhere' }, first.version);
  const onDisk = readFileSync(join(dir, 'x.json'), 'utf8');

  let err = null;
  try { B.write(dir, 'x', { ...board('X'), name: 'my autosave' }, first.version); }
  catch (e) { err = e; }
  eq(err?.code, 'stale', 'refused');
  eq(readFileSync(join(dir, 'x.json'), 'utf8'), onDisk, 'and the file is untouched');
});

s.check('and the refusal hands back what is actually there', () => {
  // So the editor can show it and ask, rather than choosing for you.
  const dir = fresh();
  const first = B.write(dir, 'x', board('X'), null);
  B.write(dir, 'x', { ...board('X'), name: 'theirs' }, first.version);
  let err = null;
  try { B.write(dir, 'x', board('mine'), first.version); } catch (e) { err = e; }
  eq(err.project.name, 'theirs', 'the newer board');
  ok(err.version, 'and its version');
});

s.check('a write with the current version succeeds', () => {
  const dir = fresh();
  const a = B.write(dir, 'x', board('X'), null);
  const b = B.write(dir, 'x', { ...board('X'), name: 'Y' }, a.version);
  eq(B.read(dir, 'x').project.name, 'Y', 'it took');
  ok(b.version, 'and a new version came back');
});

s.check('creating a board that already exists is refused', () => {
  const dir = fresh();
  B.write(dir, 'x', board('X'), null);
  let code = null;
  try { B.write(dir, 'x', board('other'), null); } catch (e) { code = e.code; }
  eq(code, 'exists', 'named, and the first board is safe');
  eq(B.read(dir, 'x').project.name, 'X', 'untouched');
});

// -------------------------------------------------------------- list

s.check('LISTING GIVES EVERY BOARD WITH ITS NAME', () => {
  const dir = fresh();
  B.write(dir, 'b-one', board('Beta'), null);
  B.write(dir, 'a-two', board('Alpha'), null);
  const rows = B.list(dir);
  eq(rows.length, 2, 'both');
  eq(rows.map((r) => r.name), ['Alpha', 'Beta'], 'sorted by name');
  eq(rows.map((r) => r.slug), ['a-two', 'b-one'], 'each with its slug');
  ok(rows.every((r) => r.version), 'and a version');
});

s.check('an empty or missing directory lists nothing rather than throwing', () => {
  eq(B.list(fresh()), [], 'empty');
  eq(B.list(join(fresh(), 'not-there')), [], 'missing');
});

s.check('a file that is not a board is left alone', () => {
  const dir = fresh();
  writeFileSync(join(dir, 'README.md'), '# boards');
  writeFileSync(join(dir, 'broken.json'), '{ not json');
  B.write(dir, 'good', board('Good'), null);
  const rows = B.list(dir);
  eq(rows.filter((r) => !r.unreadable).map((r) => r.slug), ['good'], 'the good one');
  ok(rows.some((r) => r.unreadable), 'and the broken one is reported, not hidden');
});

// ------------------------------------------------------------- rename

s.check('RENAMING MOVES THE FILE AND TAKES THE NAME WITH IT', () => {
  const dir = fresh();
  B.write(dir, 'old-name', board('Old Name'), null);
  const r = B.rename(dir, 'old-name', 'New Name');
  eq(r.slug, 'new-name', 'the new slug');
  ok(!existsSync(join(dir, 'old-name.json')), 'the old file has gone');
  eq(B.read(dir, 'new-name').project.name, 'New Name', 'and the name is in the file');
});

s.check('renaming onto an existing board is refused', () => {
  const dir = fresh();
  B.write(dir, 'a', board('A'), null);
  B.write(dir, 'b', board('B'), null);
  let code = null;
  try { B.rename(dir, 'a', 'B'); } catch (e) { code = e.code; }
  eq(code, 'exists', 'refused');
  eq(B.read(dir, 'b').project.name, 'B', 'B is untouched');
});

s.check('renaming to the same name is not a clash with itself', () => {
  const dir = fresh();
  B.write(dir, 'a-board', board('A Board'), null);
  const r = B.rename(dir, 'a-board', 'A Board');
  eq(r.slug, 'a-board', 'still there');
});

s.check('remove takes the file away', () => {
  const dir = fresh();
  B.write(dir, 'x', board('X'), null);
  B.remove(dir, 'x');
  eq(B.list(dir), [], 'gone');
});

process.exit((await s.run()) ? 0 : 1);
