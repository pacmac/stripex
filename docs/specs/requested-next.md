# SPEC — asked for, not started

status: placeholder — each of these gets its own spec when it is worked

These are Peter's words, recorded at the moment he said them, so they cannot be lost between
sessions. Each has a register entry pointing here; when one is picked up it gets a spec of its
own and its entry is amended to point at that instead.

## A tool should act on what is already selected

Peter, 2026-08-30: *"sometimes I will select a component then press the move/delete etc etc
button, but sometimes I will select the move/delete etc and then select the component. only
the latter is now supported."*

Every tool today is **verb then noun**: arm the tool, then click the thing. Rotate is the
exception — it acts on the selection — which is precisely why the asymmetry is noticeable.

What it needs to mean, per tool, with something already selected:

| tool | with a selection |
|---|---|
| delete | delete it, and disarm as `delete-disarms.md` says |
| move | arm the move on it, held by a pin — which pin is the open question, and pin 1 is the obvious default |
| rotate | already does this |
| break | a cut is not a thing you select first; leave it verb-then-noun |
| wire, place | likewise — they need a hole, not a selection |

So this is not "make every tool work both ways". It is: **the tools that operate on an
existing object should accept it from the selection**, and the ones that create something at a
hole should not pretend to.

## Pin identity as a layer

Peter, 2026-08-30: *"comonnets (xiao etc) dont seem to have pin ID/Name/Numbers as a layer."*

The pin names are on the placement — `placementFor` copies them, `resolvePins` resolves them,
the DRC quotes them — but nothing DRAWS them. On a 14-pin XIAO you cannot tell which pad is
`D4` without counting, which is the moment you get a board wrong.

It is a layer of its own, beside `netNames` and `labels`, for the same reason those are
separate: a board full of pin names is unreadable while you are placing parts and essential
while you are wiring.

Open questions for its own spec: where the name sits relative to the pad, what happens when it
does not fit between two adjacent pads, and whether the number is shown when a pin has a real
name.
