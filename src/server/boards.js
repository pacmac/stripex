// Boards as files on disk: boards/<slug>.json.
//
// Everything here takes the directory as an argument rather than reaching for a
// global, so a test can point it at a temporary one and the server can point it
// at the repo's.
//
// THE SLUG IS VALIDATED, NEVER MERELY CONSTRUCTED. `/api/boards/:slug` turns a
// piece of URL into a filesystem path, which is the one place in this project
// where getting it wrong hands out the whole disk. `..`, a leading slash, a NUL
// and an absolute path are refused before anything touches the filesystem, and
// the check is a whitelist — a blacklist of the tricks I happen to have thought
// of is not a defence.

import { createHash } from 'node:crypto';
import {
  readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export const isSlug = (s) => typeof s === 'string' && s.length <= 64 && SLUG_RE.test(s);

// A name a person typed, to the name a file can have. Lowercase, words joined
// with a hyphen, everything else dropped, runs collapsed.
export function slugFor(name) {
  const s = String(name ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')          // don't turn "Peter's" into "peter-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .replace(/-+$/, '');
  return isSlug(s) ? s : null;
}

// The version of a board: the SHA-256 of the bytes on disk.
//
// A HASH RATHER THAN AN MTIME. Two writes inside one filesystem timestamp tick
// is exactly the case this exists to catch, and it is the likely one — an editor
// autosaving while somebody edits the file by hand.
export const versionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const fileFor = (dir, slug) => {
  if (!isSlug(slug)) throw new BoardError('bad-slug', `${JSON.stringify(slug)} is not a board name`);
  return path.join(dir, `${slug}.json`);
};

export class BoardError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function list(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const slug = f.slice(0, -5);
      if (!isSlug(slug)) return null;          // not ours; leave it alone
      let project = null;
      let text = '';
      try {
        text = readFileSync(path.join(dir, f), 'utf8');
        project = JSON.parse(text);
      } catch { return { slug, name: slug, unreadable: true }; }
      return {
        slug,
        name: project?.name || slug,
        cols: project?.board?.cols ?? null,
        rows: project?.board?.rows ?? null,
        parts: project?.placements?.length ?? 0,
        version: versionOf(text),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function read(dir, slug) {
  const file = fileFor(dir, slug);
  if (!existsSync(file)) throw new BoardError('no-such-board', `there is no board called ${slug}`);
  const text = readFileSync(file, 'utf8');
  return { project: JSON.parse(text), version: versionOf(text) };
}

export const exists = (dir, slug) => existsSync(fileFor(dir, slug));

// Write, but only over the version the caller was working from.
//
// `expected` null means "this is a new board" and the file must not exist.
// Anything else must match what is on disk, or the write is refused and the
// caller is handed what is actually there — the editor asks rather than choosing.
export function write(dir, slug, project, expected) {
  const file = fileFor(dir, slug);
  ensureDir(dir);
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const current = versionOf(text);
    if (expected == null) {
      throw new BoardError('exists', `${slug} already exists`, { version: current });
    }
    if (expected !== current) {
      throw new BoardError('stale', `${slug} has changed since you opened it`, {
        version: current, project: JSON.parse(text),
      });
    }
  } else if (expected != null) {
    throw new BoardError('no-such-board', `there is no board called ${slug}`);
  }
  const text = `${JSON.stringify(project, null, 2)}\n`;
  writeFileSync(file, text);
  return { slug, version: versionOf(text) };
}

export function rename(dir, slug, name) {
  const from = fileFor(dir, slug);
  if (!existsSync(from)) throw new BoardError('no-such-board', `there is no board called ${slug}`);
  const next = slugFor(name);
  if (!next) throw new BoardError('bad-name', `${JSON.stringify(name)} has no usable name in it`);
  const to = fileFor(dir, next);
  if (next !== slug && existsSync(to)) {
    throw new BoardError('exists', `there is already a board called ${next}`);
  }
  const project = { ...read(dir, slug).project, name };
  const text = `${JSON.stringify(project, null, 2)}\n`;
  writeFileSync(from, text);
  if (next !== slug) renameSync(from, to);
  return { slug: next, name, version: versionOf(text) };
}

export function remove(dir, slug) {
  const file = fileFor(dir, slug);
  if (!existsSync(file)) throw new BoardError('no-such-board', `there is no board called ${slug}`);
  unlinkSync(file);
  return { slug };
}
