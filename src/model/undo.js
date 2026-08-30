// The undo and redo stacks.
//
// SNAPSHOTS, NOT COMMAND/INVERSE PAIRS. The project is small and JSON-cloneable,
// so a snapshot stack is correct by construction; an inverse-command stack needs
// every tool to get its own undo right and one of them eventually would not.
// That decision was right and is unchanged.
//
// What was wrong was WHEN the snapshot was taken. The editor's tools mutate the
// project in place and then call commit, and commit pushed the project it was
// handed — which by then is the state AFTER the change. So undo popped the state
// you were already in: the first press did nothing, every later press was a step
// behind, and the state before the first edit of a session was never pushed by
// anything and could never be reached.
//
// The fix is a BASELINE: the project as it stood after the last commit. commit
// pushes that and then becomes it. Asking each of the fifteen call sites to
// capture its own "before" would be the same failure waiting in a new place.
//
// It lives here rather than in public/app.js because there was NO WAY TO TEST IT
// there — app.js exports nothing and the node harness has no DOM. A bug that
// survived since the editor's first commit survived because nothing could reach
// it.

export const DEFAULT_LIMIT = 200;

const clone = (project) => JSON.parse(JSON.stringify(project));

export function makeUndo(initial, limit = DEFAULT_LIMIT) {
  let baseline = JSON.stringify(initial ?? null);
  const undoStack = [];
  const redoStack = [];

  return {
    // The project has just changed. Push what it was, and remember what it is.
    commit(project) {
      undoStack.push(baseline);
      // The OLDEST goes when the bound is hit. Dropping the newest would make
      // the last thing you did the one thing you cannot take back.
      while (undoStack.length > limit) undoStack.shift();
      baseline = JSON.stringify(project);
      // The history has forked: a redo would install a state that never
      // followed the one you are now in.
      redoStack.length = 0;
    },

    // Returns the previous project, or null when there is nothing to undo —
    // null rather than the current project, so a caller cannot mistake "no"
    // for "here it is, unchanged".
    undo(current) {
      if (!undoStack.length) return null;
      redoStack.push(JSON.stringify(current));
      baseline = undoStack.pop();
      return clone(JSON.parse(baseline));
    },

    redo(current) {
      if (!redoStack.length) return null;
      undoStack.push(JSON.stringify(current));
      baseline = redoStack.pop();
      return clone(JSON.parse(baseline));
    },

    // A new starting point — a file loaded, a snapshot restored. NOT an
    // undoable edit: undoing into the board it replaced would be a surprise
    // rather than a mercy, and the two boards have nothing to do with each
    // other.
    reset(project) {
      baseline = JSON.stringify(project ?? null);
      undoStack.length = 0;
      redoStack.length = 0;
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    depth: () => undoStack.length,
  };
}
