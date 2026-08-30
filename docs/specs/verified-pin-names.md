# SPEC — a pin name is either verified or it says it is not

status: draft
area: component-library
source_hash: (set in Phase 4)

## What is wrong

`tmc2209` carries `unverifiedPins: ['NC3', 'NC4']` and nothing has ever checked them. The
catalogue's comment is honest about where the rest came from — a SilentStepStick v2.0 board
file's nets, in pad order — and says these two "are not traceable to anything".

## Phase 1: I went to verify them, and the answer is that I cannot

Two sources, both consulted this session:

- **Watterott's own pin-config page for the TMC2209 SilentStepStick** lists the two columns and
  **has no pin called CLK at all**; the positions an A4988 uses for RST and SLP are not named in
  its text.
- **RepRap's TMC2209 page** carries pinouts for six different modules — Watterott, Panucatt,
  BTT, Fysetec, Lerdge, makerbase — as images, and states that **DIAG, INDEX and VREF are the
  pins most likely to differ between modules.**

The two unverified positions are precisely the ones the sources say vary by manufacturer. So
there is no correct answer to "what is TMC2209 pin 3" — only "what is pin 3 **on the module
Peter has**", and no amount of reading settles that. Guessing it and removing the flag would
convert an honest unknown into a confident error on a board someone solders.

**Peter's own board says something different again.** His net names, placed by eye on the
strips under that chip, read down the column: `DIR CLK URT PDN MS2 MS1 EN`. `CLK` and `URT` are
not names Watterott's page uses. That is not evidence the catalogue is wrong — his chip is a
bare `dip` with no pin names at all, so the two have never been compared by anything — but it
IS a second reading of the same physical part that disagrees with the first.

## The change

**The catalogue stops being the only place a pin name can come from, and unverified stops being
invisible.**

1. **`pinSource` on a device** — one line saying where its names came from
   (`'SilentStepStick v2.0 board file, pad order'`), shown in the Focus panel beside the part.
   A name with no provenance is a name nobody can check.
2. **An unverified pin is drawn as such** — its name in the pin-names layer gets the same
   treatment a DRC warning gets, so it is visible on the board rather than only in a field of
   the catalogue nobody opens.
3. **`ops.setPinNames(project, ref, names)`** — a placement may carry names that differ from its
   device, because the placement is the board and the catalogue is a suggestion. This is the
   mechanism by which Peter's answer, when he gives it, becomes part of the board rather than a
   remark in a chat log.
4. **`GET /api/devices` already reports `unverifiedPins`** and keeps doing so.

## The question only Peter can answer, and it is asked rather than guessed

**What does the silkscreen on your TMC2209 say, going down each column?** Ten seconds with the
module in hand settles what two web sources and one board file cannot. Until he answers, the
names stay flagged and the flag is now visible.

This is filed as an `ask-` item so it survives this session, per `/idiot mine`.

## Files

| file | change |
|---|---|
| `src/parts/devices.js` | `pinSource` on `xiao` and `tmc2209`; the comment corrected to say the sources disagree |
| `src/model/ops.js` | `setPinNames` |
| `src/render/svg.js` | an unverified pin name is drawn as unverified |
| `public/app.js` | Focus shows the provenance |

## Explicitly NOT changed

- **The two names themselves.** `NC3` and `NC4` stay until a person reads the part. Renaming
  them from a web page that describes a different module is the error this spec exists to
  prevent.
- The XIAO's names, which are not in doubt.
- `placementFor`, and the rule that a placement copies the catalogue and never references it.

## What a green run means

`tests/parts/test_pin_provenance.mjs` reports `N/N`:

- every device with `unverifiedPins` also carries a `pinSource`, and every name in
  `unverifiedPins` is actually one of that device's pins — the check that stops the flag
  drifting from the list it points at;
- an unverified pin name renders differently from a verified one;
- `setPinNames` replaces a placement's names, is refused when the count is wrong, and leaves the
  catalogue untouched;
- and a placement whose names were set by hand keeps them across a rotate and a move, because a
  name that survives being flagged and then vanishes on the next edit is worse than no name.
