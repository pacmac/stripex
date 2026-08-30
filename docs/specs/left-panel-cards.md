# SPEC — cards that own their settings, and a library shaped to grow

status: implemented, entry CLOSED
area: editor-ui, component-library
source_hash:
  src/parts/devices.js:   b7ad423a40d7341234418277fab1ef82ff5341d509000778bc2175629bf11d14
  src/parts/library.js:   b9af3c60f8b959ae17c6e9f766d712e79dae9fb1874f3dcf0acff2def0f11bcf
  src/render/panels.js:   a24a28d7bedcdb7567c6399734a563263f170fc495b544f2e2f998e7b7c5e5c7
  src/model/rotate.js:    b5c296094b3ea82accabf9e26fec002c2225e1634b33e5e3406d8730d16ac5d2
  public/index.html:      276746e4443aa31792e2129d3748d324adbb2689e79cbfc47bca2591eb432d11
  public/app.js:          1c471ae6ab6abc1fd9f17a5a5d1dbcbf0dae88cd25466d79dee0623cc6762d4e
  public/style.css:       ad734f0d556b3bb29539c837ec1b5111e0d551b64f4b73c7ce174d9e6f3e12fd

## What the browser actually did

Red 1/14 and 0/12 → green 14/14 and 12/12, entry closed. 35 suites.

| | |
|---|---|
| cards, in order | `library, cutting, layers, board` |
| open at start | library |
| arm Break | opens **cutting** |
| arm Place | opens **library** |
| arm Select | leaves whatever was open — it owns no settings |
| LED chosen | **0** parameter boxes |
| DIP chosen | `span`, `width` |
| resistor chosen | `span` only |
| groups | Wiring, Passives, Semiconductors, ICs and sockets, Surface mount, Connectors, Mechanical |
| search `cap` | 3 parts in 2 groups |
| card subtitles | `Resistor (axial)` · `knife` · `25 × 20` |

## A defect the screenshot showed and the checks did not

With the Library open, its list pushed **Cutting, Layers and Board off the bottom of the
panel**. All three existed and were reachable by scrolling, and every check passed — but you
could not see that they were there, which defeats the point of having cards at all.

An open card now scrolls inside itself with the headers sticky. Verified by measuring: all
four headers inside the viewport with the Library open.

## Two things left deliberately undone

**The catalogue.** One worked device, `tmc2209`, built from the parameters on Peter's own
board. Its **pin names are unverified** and say so in the record and on the device list; they
exist to prove names reach the DRC and the run list. A pinout invented from memory would look
authoritative and be wrong.

**XIAO.** Not added. I do not know its pin count, row spacing or pin names, and will not
guess them.

Peter, 2026-08-30: *"spans and width are a feature of DIP, knife/spot face are a feature of
break. right now they are just left menu items disassociated with what they belong to … each
type needs to be an accordion … I think it should have panels / cards that are associated
with different func"* and *"bear in mind the future component lib as well, not saying add it
now but plan for it."*

## What is there now

```
Parts        14 buttons, flat
Span/Width   belong to the chosen part, not to the panel
Cut with     belongs to the Break tool, shown always
Layers       a view concern
```

Four unrelated things stacked, with two of them being settings that float free of what they
configure. And a further fault of mine: **Span and Width appear in two places** — the left
panel sets them for the *next* placement, the Focus panel sets them on the *selected* one —
with nothing saying which is which.

## Cards

Four, always listed, each a collapsed header with an icon:

| card | holds | opens when |
|---|---|---|
| **Library** | the parts, grouped, with the chosen part's parameters beneath it | Place or Wire is armed |
| **Cutting** | knife / spot-face | Break is armed |
| **Layers** | the eight visibility switches | never automatically — it is a view concern, not a tool's |
| **Board** | size, and the project name | never automatically |

Arming a tool opens its card and closes the others; any card can still be opened by hand,
and a card opened by hand is not closed by the next tool change until you arm a tool that
owns one. **Nothing ever disappears**, so the panel's shape is learnable — which is the
whole reason for cards over a tool-contextual panel that empties itself.

The Library card's header names the chosen part, so the panel says what the next click will
do even when collapsed: `Library — DIP / IC socket`.

## Parameters live under the part they belong to

Choosing a part reveals **its own** parameters immediately beneath it in the list:

- DIP → pins per side, body width
- resistor, diode, capacitor, header, link → span only
- LED, TO-92, TO-220, mounting hole, 0603 → none
- point to point → none, it is drawn not placed

That is the complaint answered directly: a parameter is visibly attached to its owner, and a
part with no parameters shows none rather than showing two disabled boxes.

The two homes are then labelled rather than merely coexisting: the left card is **"what the
next one will be"**, the Focus panel is **"this one"**.

## Planning for the component library

The catalogue is not built here. What is built is the shape that accepts it as **data**.

**A device is a preset over a generic footprint.** Peter built one by hand already: his
TMC2209 is a `dip` with `span 8, width 5, silk #2f9e44, autoBreak false`. So:

```js
{ id: 'tmc2209', name: 'TMC2209 StepStick', category: 'module',
  base: 'dip', span: 8, width: 5, silk: '#2f9e44', autoBreak: false,
  pins: ['EN', 'MS1', 'MS2', 'PDN', ...] }
```

Adding a device is adding a record. No geometry, no rendering, no new code path — which is
what "plan for it" has to mean if it is to be true later.

Four things must be right now or the catalogue forces a rewrite:

1. **`category` on every entry**, so 60 parts group instead of scrolling. Present from the
   start even while there are 14, because retrofitting a taxonomy means touching every
   entry and every caller.
2. **A search box** in the Library card. Useless at 14 and essential at 60; it costs
   almost nothing now and cannot be bolted onto a list that has grown a different shape.
3. **`pinLabel(part, index)` as the single way anything names a pin**, so numbered parts and
   named devices go through one path. Every existing message — the DRC, the run list, the
   Focus panel — must be moved onto it *now*, while there are few of them.
4. **Presets resolve at placement, not at render.** Placing a TMC2209 stores a `dip`
   placement carrying the preset's parameters and a `device: 'tmc2209'` tag. The renderer,
   the DRC and the netlist never learn what a device is. A board saved today still opens if
   the catalogue changes tomorrow, because the geometry is in the placement.

> Point 4 is the one that matters most. If a placement merely referenced a device id, then
> editing or removing a catalogue entry would silently change or break every board that used
> it. Peter has already lost a board once this session to exactly that shape of coupling.

## Pin names, used everywhere

With names available, `U1 has 5 and 6 on the same strip segment` becomes
`U1.STEP and U1.DIR are on the same strip segment`, and a run list row reads
`A: U1.STEP → J2.3`. Numbered parts are unaffected — `pinLabel` returns the number.

## Files

| file | change |
|---|---|
| `src/parts/devices.js` | **new** — the preset record shape, `resolveDevice()`, one worked example |
| `src/parts/library.js` | `category` on every part; `pinLabel()` |
| `src/render/panels.js` | `CARDS`, `cardForTool()` |
| `public/index.html` | the card containers |
| `public/app.js` | build cards; parameters under the chosen part; search |
| `public/style.css` | card and search styling |
| `src/net/drc.js`, `src/net/derive.js` | pin names in messages and the run list |

## Explicitly NOT changed

- The right-hand Focus panel's contents, beyond labelling what it is.
- The catalogue itself. One worked device proves the model; the rest is data Peter supplies,
  because inventing a pinout would produce something that looks authoritative and is wrong.
- The board model. A device leaves no trace in a saved project beyond a `device` tag and the
  parameters it set.

## What a green run means

`tests/render/test_cards.mjs` and `tests/parts/test_devices.mjs` report `N/N checks passed`:
every tool maps to a card or to none; Layers and Board never open automatically; every part
declares a category and the categories are a closed set; `pinLabel` returns a name for a
device and a number for a generic part; a device resolves to a placement carrying its
parameters **and no dependency on the catalogue**; deleting a device from the catalogue
leaves an existing board unchanged; and a DRC message on a named device uses its pin names.
