// Snapshots, so there is always something to go back to.
//
// Peter lost a board and, worse, lost a part from it at some earlier moment
// nobody can now identify — because the only thing on disk was the current
// board. Undo lives in memory and dies on reload. There was nothing to look at.
//
// THE RULE THAT MATTERS: if something has to give, it is never the board the
// user is looking at. History is the first thing dropped when storage is full,
// and the current board is always written first.

export const HISTORY_KEY = 'stripex.history';

// Thirty. A snapshot of a real board — Peter's has 13 parts and 12 cuts — is
// about 2 KB, so thirty is roughly 60 KB against a 5 MB localStorage budget:
// under 2%. That is the arithmetic, not a round number picked for looking
// sensible, and thirty edits is far enough back to pass a mistake nobody
// noticed at the time.
export const MAX_SNAPSHOTS = 30;

export function readHistory(store) {
  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    // A corrupt history is no history. It must never be able to take the board
    // with it, which is why it lives under its own key.
    return [];
  }
}

// Returns true if the snapshot was written. Newest first.
export function pushSnapshot(store, project, now = () => new Date().toISOString()) {
  const body = JSON.stringify(project);
  const history = readHistory(store);

  // An identical board is not worth a slot: otherwise thirty fill with the same
  // picture and the history answers nothing.
  if (history[0] && JSON.stringify(history[0].project) === body) return true;

  let list = [{ at: now(), project: JSON.parse(body) }, ...history].slice(0, MAX_SNAPSHOTS);

  // Drop the oldest until it fits. Never give up on the newest — that is the
  // one being asked for.
  while (list.length > 0) {
    try {
      store.setItem(HISTORY_KEY, JSON.stringify(list));
      return true;
    } catch {
      list = list.slice(0, list.length - 1);
    }
  }
  try { store.removeItem(HISTORY_KEY); } catch { /* nothing more to give */ }
  return false;
}

// Enough to choose between snapshots by eye rather than by counting clicks.
export function describe(snapshot) {
  const p = snapshot?.project ?? {};
  return {
    when: snapshot?.at ?? null,
    parts: (p.placements ?? []).length,
    wires: (p.wires ?? []).length,
    cuts: (p.breaks ?? []).length,
  };
}
