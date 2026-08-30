// Colour: wires by the component code, parts by their silkscreen colour, and
// telling the two halves of a cut strip apart.

// The standard 0-9 component colour code — the one on every resistor and in
// every drawer of hook-up wire.
export const COLOUR_CODE = [
  { name: 'black', hex: '#1c1c1c' },
  { name: 'brown', hex: '#7b4a12' },
  { name: 'red', hex: '#c92a2a' },
  { name: 'orange', hex: '#e8590c' },
  { name: 'yellow', hex: '#e6c02a' },
  { name: 'green', hex: '#2f9e44' },
  { name: 'blue', hex: '#1971c2' },
  { name: 'violet', hex: '#7048e8' },
  { name: 'grey', hex: '#909296' },
  { name: 'white', hex: '#f1f3f5' },
];

// The tool Escape returns to. Escape means "stop what I am doing", and the armed
// tool is part of what you are doing: cancelling a half-drawn wire should not
// leave the next click starting another one.
export const TOOL_AFTER_ESCAPE = 'select';

// Sixteen swatches: the ten code colours plus six for parts. The native colour
// input opens an operating-system dialog with a spectrum, an eyedropper and a
// hex field, for a choice between a handful of sane values on a board.
export const PALETTE_16 = [
  ...COLOUR_CODE,
  { name: 'pink', hex: '#f06595' },
  { name: 'cyan', hex: '#22b8cf' },
  { name: 'teal', hex: '#0ca678' },
  { name: 'gold', hex: '#f59f00' },
  { name: 'maroon', hex: '#862e2e' },
  { name: 'navy', hex: '#1b3a6b' },
];

// The colour for a wire of this many holes.
//
// It is keyed on LENGTH, not on the wire's number. Colour tells you which
// pre-cut wire to take out of the drawer, so a 3-hole wire is orange in every
// project and on every board. Wrapping at ten is the same idea: the drawer has
// ten compartments, so an 11-hole wire is brown like a 1-hole one.
export function colourForLength(holes) {
  const n = Math.max(0, Math.round(Number(holes) || 0));
  return COLOUR_CODE[n % COLOUR_CODE.length].hex;
}

// How long a pen wire is, in holes. Straight-line, because a pen wire runs
// diagonally and the wire you cut for it is that long: a 3-4-5 diagonal is a
// 5-hole wire and takes the same green as a straight 5-hole one, which is right
// — they are the same piece of wire.
export function wireLengthHoles(wire) {
  if (!wire?.from || !wire?.to) return 0;
  return Math.round(Math.hypot(wire.to.col - wire.from.col, wire.to.row - wire.from.row));
}

// A wire's colour: its own override, else the colour for its length.
export function wireColour(wire) {
  if (wire?.colour) return wire.colour;
  return colourForLength(wireLengthHoles(wire));
}

// A wire LINK is a piece of wire too, so its body is coloured by its span. Its
// pads are not: they stay silkscreen like every other part's, so a link reads as
// a coloured wire between two ordinary pads.
//
// `kind: 'link'` is what marks a part as wire-coloured, so a future zero-ohm
// part gets it without a second list to keep in step.
export const isWireColoured = (part) => part?.kind === 'link';

export function linkColour(placement, part) {
  if (placement?.colour) return placement.colour;
  return colourForLength(placement?.span ?? part?.defaultSpan ?? 0);
}

// A part's silkscreen colour: this placement, then the library's default for the
// type, then the theme. It paints the outline and the wash only — never the
// pads, so a pale part on a pale board cannot make its own pads unreadable.
export function silkOf(placement, part, themeSilk) {
  return placement?.silk ?? part?.silk ?? themeSilk;
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (rgb) => `#${rgb.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// How much a shaded segment shifts. Big enough to see along a row, small enough
// not to read as a stripe pattern competing with the parts.
export const SEGMENT_SHADE_DELTA = 22;

// Adjacent segments of one row alternate shades, so two halves of a cut strip
// cannot read as one strip. That misreading is the most expensive this tool can
// cause: it is the difference between a working circuit and a short.
//
// An uncut row is a single segment at index 0 and is returned unchanged, so an
// uncut board looks exactly as it did.
export function segmentShade(hex, index) {
  if (index % 2 === 0) return hex;
  const rgb = parse(hex);
  // Lighten a dark copper, darken a light one, so the hint survives either way.
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const dir = mean < 128 ? 1 : -1;
  return toHex(rgb.map((v) => v + dir * SEGMENT_SHADE_DELTA));
}
