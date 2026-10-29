// User-defined macros. A selection becomes a reusable symbol; its pins are the
// free ends of wire stubs in the selection (ends that touch nothing else).

import { distToSegment, isHorizontal, shapeBounds, unionRects } from './geometry';
import { bindConnections, expandGroups, translateShape } from './edits';
import { findJunctions } from './junctions';
import { MACRO_TEMPLATES } from './macros';
import { newId, type CustomDef, type CustomPort, type Doc, type MacroShape, type Pt, type Shape } from './types';

const GRID = 10;

const onRectBorder = (p: Pt, s: { x: number; y: number; w: number; h: number }) => {
  const { x, y, w, h } = s;
  const corners = [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ];
  return corners.some((a, i) => distToSegment(p, a, corners[(i + 1) % 4]) < 0.5);
};

/** Does this wire end touch another shape of the selection? */
const touches = (p: Pt, self: string, shapes: Shape[]): boolean =>
  shapes.some((s) => {
    if (s.id === self) return false;
    if (s.type === 'box' || s.type === 'macro') return onRectBorder(p, s) || (s.type === 'macro' && pointInside(p, s));
    if (s.type === 'wire') return s.points.some((q, i) => i + 1 < s.points.length && distToSegment(p, q, s.points[i + 1]) < 0.5);
    if (s.type === 'dot') return Math.hypot(p.x - s.x, p.y - s.y) <= s.r;
    return false;
  });

const pointInside = (p: Pt, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export type MakeResult = { ok: true; doc: Doc; instance: MacroShape; def: CustomDef } | { ok: false; error: string };

/** Replace the selected shapes by an instance of a new custom macro at the same spot. */
export const makeCustomMacro = (doc: Doc, selection: string[], name: string): MakeResult => {
  const ids = expandGroups(doc, selection);
  const shapes = ids.map((id) => doc.shapes[id]).filter(Boolean);
  if (shapes.length < 1) return { ok: false, error: 'Select the shapes that make up the macro first.' };
  const b = unionRects(shapes.map(shapeBounds))!;
  const ox = Math.floor(b.x / GRID) * GRID, oy = Math.floor(b.y / GRID) * GRID;

  const ports: CustomPort[] = [];
  const used = new Set<string>();
  for (const w of shapes) {
    if (w.type !== 'wire' || w.points.length < 2) continue;
    const ends = [
      { p: w.points[0], next: w.points[1] },
      { p: w.points[w.points.length - 1], next: w.points[w.points.length - 2] },
    ];
    for (const { p, next } of ends) {
      if (touches(p, w.id, shapes)) continue;
      let pin = w.label?.trim() || `p${ports.length}`;
      for (let k = 2; used.has(pin); k++) pin = `${w.label?.trim() || 'p'}_${k}`;
      used.add(pin);
      ports.push({ name: pin, x: p.x - ox, y: p.y - oy, horizontal: isHorizontal(p, next) });
    }
  }

  // Automatic junction dots inside become real dots: the instance no longer exposes its wires.
  const sub: Doc = { shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: ids };
  const dots: Shape[] = findJunctions(sub).map((j) => ({ id: newId(), type: 'dot', x: j.p.x, y: j.p.y, r: j.r, color: j.color }));

  const inner = [...shapes, ...dots].map((s) => {
    const moved = translateShape(s, -ox, -oy);
    const { groupId: _g, ...rest } = moved;
    if (rest.type === 'wire') {
      const { from: _f, to: _t, ...wire } = rest;
      return wire as Shape;
    }
    return rest as Shape;
  });
  const w = Math.ceil((b.x + b.w - ox) / GRID) * GRID, h = Math.ceil((b.y + b.h - oy) / GRID) * GRID;
  const def: CustomDef = { id: newId('m'), name: name.trim() || 'Macro', w: Math.max(w, GRID), h: Math.max(h, GRID), shapes: inner, ports };
  const instance = customInstance(def, { x: ox, y: oy });

  // The instance takes the z-position of the topmost shape it replaces.
  const gone = new Set(ids);
  const top = Math.max(...ids.map((id) => doc.order.indexOf(id)));
  const order: string[] = [];
  doc.order.forEach((id, i) => {
    if (!gone.has(id)) order.push(id);
    if (i === top) order.push(instance.id);
  });
  const all = { ...doc.shapes, [instance.id]: instance };
  for (const id of gone) delete all[id];
  // Outside wires ending on a pin are attached to the instance.
  const next = bindConnections({ shapes: all, order }, order.filter((id) => all[id].type === 'wire'));
  return { ok: true, doc: next, instance, def };
};

/** An instance of a custom macro with its top-left corner at `at`. */
export const customInstance = (def: CustomDef, at: Pt): MacroShape => ({
  ...MACRO_TEMPLATES[0].make(at, { inputs: 2 }),
  id: newId(),
  kind: 'custom',
  w: def.w,
  h: def.h,
  label: def.name,
  custom: def,
});

/** Turn an instance back into ordinary shapes (fresh ids) at its position. */
export const explodeCustom = (doc: Doc, id: string): { doc: Doc; ids: string[] } => {
  const m = doc.shapes[id];
  if (m?.type !== 'macro' || m.kind !== 'custom' || !m.custom) return { doc, ids: [] };
  const parts = m.custom.shapes.map((s) => ({ ...translateShape(s, m.x, m.y), id: newId() }));
  const shapes = { ...doc.shapes };
  delete shapes[id];
  for (const p of parts) shapes[p.id] = p;
  const at = doc.order.indexOf(id);
  const order = [...doc.order.slice(0, at), ...parts.map((p) => p.id), ...doc.order.slice(at + 1)];
  return { doc: bindConnections({ shapes, order }, order.filter((x) => shapes[x].type === 'wire')), ids: parts.map((p) => p.id) };
};
