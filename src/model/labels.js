// Spreadsheet-column labels for point-to-point wires: A, B, … Z, AA, AB, …
//
// A pen wire is not drawn as a line — it appears as two pads sharing an ID —
// so the ID is the whole of what identifies it on the board. Short labels
// matter, which is why letters rather than W1, W2.

const A = 'A'.charCodeAt(0);

// Bijective base 26. There is no zero digit, which is why Z is followed by AA
// and not by BA: each place holds 1..26, not 0..25.
export function columnLabel(n) {
  let i = Math.max(1, Math.floor(Number(n) || 1));
  let out = '';
  while (i > 0) {
    const rem = (i - 1) % 26;
    out = String.fromCharCode(A + rem) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

// The inverse. Returns 0 for anything that is not a plain letter label, so an
// old W1 ref reports "not a column label" rather than pretending to be one.
export function labelIndex(label) {
  const s = String(label ?? '');
  if (!/^[A-Z]+$/.test(s)) return 0;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - A + 1);
  return n;
}

// Sort order for the run list.
//
// NOT a string compare: that gives A, AA, AB, B, and the run list is a build
// document you work down. Length first, then lexically, so A, B, … Z, AA, AB.
//
// Anything that is not a column label — a W ref from an older project — sorts
// after the letters, in plain order, rather than being dropped or throwing.
export function compareLabels(a, b) {
  const ia = labelIndex(a);
  const ib = labelIndex(b);
  if (ia && ib) return ia - ib;
  if (ia) return -1;
  if (ib) return 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
