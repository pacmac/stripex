// Editing a placement's fields.
//
// A pure function returning either a new placement or the reason it was refused.
// The panel renders inputs and shows errors; it does not decide what is legal.
// That split is what makes these rules checkable in node, and it is the same one
// that keeps the renderer testable.

import { rotatePlacement, isRotation } from './rotate.js';

export function editableFields(part) {
  const fields = ['ref', 'value', 'silk', 'rot', 'col', 'row'];
  if (part.parametric) fields.push('span');
  if (part.defaultWidth != null) fields.push('width');
  // Only a part that cuts its own strips has cuts to switch off.
  if (part.requiresBreak) fields.push('autoBreak');
  return fields;
}

const refuse = (placement, error) => ({ placement, error });
const accept = (placement) => ({ placement, error: null });

// Returns { placement, error }. On refusal the placement comes back UNCHANGED —
// never half-applied, because a panel that silently keeps part of a rejected
// edit is worse than one that refuses the lot.
export function applyPlacementEdit(placement, getPart, field, value) {
  let part;
  try { part = getPart(placement.part); } catch (e) { return refuse(placement, e.message); }

  if (!editableFields(part).includes(field)) {
    return refuse(placement, `${part.name} has no ${field} to change`);
  }

  const next = { ...placement, at: { ...placement.at } };

  switch (field) {
    case 'ref': {
      const ref = String(value ?? '').trim();
      if (!ref) return refuse(placement, 'a part needs a reference');
      next.ref = ref;
      return accept(next);
    }

    case 'value':
      next.value = String(value ?? '');
      return accept(next);

    case 'silk': {
      // The part's silkscreen colour. Empty clears it, falling back to the
      // library's default for the type and then to the theme.
      const v = String(value ?? '').trim();
      if (!v) { delete next.silk; return accept(next); }
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
        return refuse(placement, 'a silkscreen colour must be a #rrggbb value');
      }
      next.silk = v.toLowerCase();
      return accept(next);
    }

    case 'span': {
      const n = Number(value);
      const min = part.minSpan ?? 1;
      if (!Number.isInteger(n)) return refuse(placement, `span must be a whole number of holes`);
      if (n < min) return refuse(placement, `${part.name} needs a span of at least ${min}`);
      next.span = n;
      return accept(next);
    }

    case 'width': {
      const n = Number(value);
      const min = part.minWidth ?? 2;
      if (!Number.isInteger(n)) return refuse(placement, 'width must be a whole number of holes');
      if (n < min) return refuse(placement, `${part.name} needs a width of at least ${min}`);
      next.width = n;
      return accept(next);
    }

    case 'autoBreak': {
      // Accepts a real boolean or the string a checkbox hands over.
      next.autoBreak = value === true || value === 'true' || value === 'on';
      return accept(next);
    }

    case 'rot': {
      const n = Number(value);
      if (!isRotation(n)) return refuse(placement, 'rotation must be 0, 90, 180 or 270');
      // Go through rotatePlacement rather than writing the field, so a part
      // turned from the panel behaves exactly as one turned with the button:
      // about its own centre, not swinging round pin 1.
      const quarters = (((n - (placement.rot ?? 0)) / 90) % 4 + 4) % 4;
      return accept(quarters === 0 ? next : rotatePlacement(next, getPart, quarters));
    }

    case 'col':
    case 'row': {
      const n = Number(value);
      if (!Number.isInteger(n)) return refuse(placement, `${field} must be a whole number`);
      next.at[field] = n;
      return accept(next);
    }

    default:
      return refuse(placement, `${field} cannot be changed`);
  }
}

// The same, for a pen wire: its ref and its two ends.
export function applyWireEdit(wire, field, value) {
  const next = { ...wire, from: { ...wire.from }, to: { ...wire.to } };
  if (field === 'ref') {
    const ref = String(value ?? '').trim();
    if (!ref) return { wire, error: 'a wire needs a reference' };
    next.ref = ref;
    return { wire: next, error: null };
  }
  if (field === 'value') {
    // A name for the run — GND, +5V — drawn beside the ID.
    next.value = String(value ?? '');
    return { wire: next, error: null };
  }
  if (field === 'silk') {
    // The colour of the ID TEXT, not of the wire. The pads are coloured by
    // length and that is load-bearing — it says which pre-cut wire to take from
    // the drawer — so silk acts on the one part of a wire that is silkscreen.
    const v = String(value ?? '').trim();
    if (!v) { delete next.silk; return { wire: next, error: null }; }
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
      return { wire, error: 'a label colour must be a #rrggbb value' };
    }
    next.silk = v.toLowerCase();
    return { wire: next, error: null };
  }
  if (field === 'colour') {
    const v = String(value ?? '').trim();
    if (!v) { delete next.colour; return { wire: next, error: null }; }
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
      return { wire, error: 'a wire colour must be a #rrggbb value' };
    }
    next.colour = v.toLowerCase();
    return { wire: next, error: null };
  }
  const m = /^(from|to)\.(col|row)$/.exec(field);
  if (!m) return { wire, error: `${field} cannot be changed` };
  const n = Number(value);
  if (!Number.isInteger(n)) return { wire, error: `${m[2]} must be a whole number` };
  next[m[1]][m[2]] = n;
  return { wire: next, error: null };
}
