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

// The digit at the end of a ref, or 0. W1 -> 1, W23 -> 23, GND -> 0.
function refNumber(ref) {
  const m = /(\d+)\s*$/.exec(String(ref ?? ''));
  return m ? Number(m[1]) : 0;
}

// A wire's colour. Its own number through the code, so the LAST DIGIT of the ref
// names the colour and a run list of thirty wires still reads off a ten-way
// drawer. An explicit `colour` on the wire wins, so a project saved before this
// existed gets colours without being migrated.
export function wireColour(wire) {
  if (wire?.colour) return wire.colour;
  return COLOUR_CODE[refNumber(wire?.ref) % COLOUR_CODE.length].hex;
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
