# SPEC — the component editor as a datasheet

status: implemented, both entries CLOSED
area: editor-ui
source_hash:
  public/index.html:  0662bb1cf3dbc6167df258a43e9668aee28c0e626abe1b474ba587697dab066c
  public/app.js:      7a18e41d6d08cd1f3b9ba07a6dae85f8c35721f551ecf30ccee7b52b9cdd8d29
  public/style.css:   8d5516f85a9e6f99107b5833d26c7ad95b966e79c6461bfc9b982f0f763bdaff

Peter, 2026-08-31: *"so many issues with that I dont know where to start … this page needs
sooooooo much work."*

He is right. I built the screen in one pass, checked that its controls worked, and never
looked at it as somebody who wanted to trust a footprint.

## What is wrong, his list and mine

| # | | |
|---|---|---|
| 1 | **the preview is an unbuildable placement** | every device is drawn at rot 0, so a DIP's pins run ALONG the strips and every pin shorts to its neighbour. The one picture on the page a person is meant to trust is a picture of a mistake. |
| 2 | pin 1 is not shown | the renderer draws it as a square pad; at preview scale that is invisible |
| 3 | a pin cannot be selected | no link at all between the drawing and the fields |
| 4 | no numbers, unreadable names | the names overlap into `DIRSTEPNC3NC4SPREADMS2 MS1 EN` |
| 5 | the fields are dumped | one grid, no hierarchy, no grouping |
| 6 | **Span and Width ignore the library** | it hands over `spanLabel: 'pins per side'` and `widthLabel: 'body width in holes (3 = 0.3 in)'` per part, and I wrote "Span" and "Width" |
| 7 | the footprint select shows internal ids | `dip`, not `DIP / IC socket` |
| 8 | silk is a full-width bar | it reads as a progress bar |
| 9 | the source field truncates | `SilentStepStick v2.0 board file,` |
| 10 | category headings are internal words | `MODULE`, `CONNECTOR` |
| 11 | no search | sixteen entries, fourteen of them JST |
| 12 | a quarter of the page is empty | while the drawing is squeezed into a band |
| 13 | the id is a disabled text input | it is an identity, not a field |
| 14 | the pin grid fights the package | eight across, so pin 8 and pin 9 — opposite ends of a DIP — sit side by side |

## The direction: a datasheet, because that is what this is

The artifact this screen mirrors already exists in the world. A manufacturer's datasheet page
is a **package drawing with numbered pins** beside a **pin table**, and nothing else. That is
exactly this content, and it is not a form.

So: the drawing is the hero and the pin table is its index, side by side, both visible at once.

```
┌───────────────┬──────────────────────────────────────────────┐
│ CATALOGUE     │ TMC2209 SilentStepStick          [Save]      │
│ [search     ] │ tmc2209 · DIP / IC socket · 16 pins · yours  │
│               ├────────────────────────┬─────────────────────┤
│ Modules       │                        │ PINS                │
│  Seeed XIAO   │      the drawing       │  1 │ DIR            │
│ ▸TMC2209 ?    │      pins ACROSS       │  2 │ STEP           │
│               │      the strips        │  3 │ NC3        ⚠   │
│ Connectors    │      numbered pads     │  … │                │
│  JST 2-way …  │      pin 1 marked      │  8 │ EN             │
│               │                        │ ───── the far side  │
│               │                        │  9 │ GND            │
│               │                        │ 16 │ VM             │
│               ├────────────────────────┴─────────────────────┤
│               │ PACKAGE  footprint · pins per side · rows ·  │
│               │          silk · ref prefix · where the names │
└───────────────┴──────────────────────────────────────────────┘
```

**The pin table breaks where the package breaks.** A DIP's pins run down one side and back up
the other, so the list splits at that turn with a rule and a label. The structure encodes the
part rather than decorating it, and it puts pin 8 and pin 9 where they actually are: at
opposite ends.

## The signature: the drawing and the table are one instrument

- **every pad carries its number**, in a badge laid over the drawing, so it reads like a
  datasheet rather than a picture with a legend somewhere else;
- **pin 1 is unmistakable** — its badge is filled, not outlined;
- **hover or focus a pin row and its pad lights**; click a pad and its row takes focus. Either
  direction, because a person coming from the part in their hand starts at the drawing, and a
  person checking a netlist starts at the table.

That is the one memorable thing, and it is the thing Peter asked for. Everything around it
stays quiet: the fields become a single spec line, the catalogue a plain list.

## Typography and colour, from the subject

The data is set in **mono** — pin numbers, ids, the footprint name — because a pin table is
data and every datasheet in the world sets one that way. The chrome keeps the app's sans.
Colour comes from the board that is already on screen: the substrate tan, the copper, and the
device silk green as the one accent. Nothing new is introduced; the page joins the app rather
than announcing itself.

## Files

| file | change |
|---|---|
| `public/index.html` | the screen's structure |
| `public/app.js` | the preview's placement, the numbered overlay, the linked selection |
| `public/style.css` | the datasheet layout |

## Explicitly NOT changed

- The device store, its validation, and the API. This is the screen only.
- `renderBoard`. The numbers are an overlay laid over its output, positioned from the pads it
  already labels, so the renderer keeps its one job.

## What a green run means

`tests/browser/test_components_screen.mjs` grows, and reports `N/N`:

- **a DIP previews with its pins across the strips**, not along them, and with the cuts its
  package requires;
- **every pad carries its number**, and pin 1's badge is marked as first;
- **focusing a pin row lights that pad**, and clicking a pad focuses that row;
- the pin table splits where the package turns, so pin 8 and pin 9 are not neighbours;
- the footprint is offered by its real name, and the span and width fields carry the labels the
  library gives them;
- the catalogue can be searched;
- and everything the first version could do — list, edit, save, revert, refuse an invalid
  edit, make a new component — still works.

## Two more, found only by looking at it

**Every field in the Package block was centred and truncating.** The base stylesheet has
`label { display: inline-flex; align-items: center }`, and `.devfield` overrode the `display`
without the `align-items` — so an input showed `SilentStepStick v2.0 boarc` in a cell with room
to spare. A CSS rule half-overridden is invisible in a diff and obvious in a screenshot.

**A lit pin survived a change of component.** Selecting a different device left pin 3 glowing on
a part that has no pin 3 worth glowing about.

Neither had a failing check, and neither would have got one: they are things you see, not
things you assert. That is the argument for looking at the page as a user, which is what Peter
told me to do.
