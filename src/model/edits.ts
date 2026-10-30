// Move / stretch engine. A drag is described as a list of targets that are
// re-applied to the snapshot taken when the drag started, so previews never
// accumulate rounding.

import { GRID } from './presets';
import { distToSegment, isHorizontal, isVertical, rectContains, rectInside, shapeBounds, simplifyPolyline, type Rect } from './geometry';
import { minMacroSize, portPosition, macroPorts, quantizeMacro } from './macros';
import { newId, type BoxShape, type Doc, type MacroShape, type PortRef, type Pt, type Shape, type WireShape } from './types';

export interface Edges {
  l: boolean;
  r: boolean;
  t: boolean;
  b: boolean;
}

export interface WirePointMove {
  i: number;
  /** 1 = follows the drag on that axis, 0 = stays. */
  mx: 0 | 1;
  my: 0 | 1;
}

export type Target =
  | { kind: 'move'; id: string }
  | { kind: 'boxEdges'; id: string; edges: Edges }
  | { kind: 'wirePoints'; id: string; pts: WirePointMove[] };

const MIN_BOX = GRID;

export const translateShape = (s: Shape, dx: number, dy: number): Shape => {
  switch (s.type) {
    case 'box':
    case 'macro':
    case 'text':
    case 'dot':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'wire':
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'raw':
      return { ...s, dx: s.dx + dx, dy: s.dy + dy };
  }
};

type RectShape = BoxShape | MacroShape;

/** Shapes whose edges can be stretched. Custom macros keep their drawn size and only move. */
export const isRectShape = (s: Shape | undefined): s is RectShape => s?.type === 'box' || (s?.type === 'macro' && s.kind !== 'custom');

const stretchRect = <T extends RectShape>(b: T, e: Edges, dx: number, dy: number): T => {
  const min = b.type === 'macro' ? minMacroSize(b) : { w: MIN_BOX, h: MIN_BOX };
  let { x, y, w, h } = b;
  if (e.l && e.r) x += dx;
  else if (e.l) {
    const d = Math.min(dx, w - min.w);
    x += d;
    w -= d;
  } else if (e.r) w = Math.max(min.w, w + dx);
  if (e.t && e.b) y += dy;
  else if (e.t) {
    const d = Math.min(dy, h - min.h);
    y += d;
    h -= d;
  } else if (e.b) h = Math.max(min.h, h + dy);
  const out = { ...b, x, y, w, h };
  // Macros snap to sizes that keep their ports on the grid.
  return out.type === 'macro' && !(e.l && e.r && e.t && e.b) ? (quantizeMacro(out, e.l && !e.r, e.t && !e.b) as T) : out;
};

/**
 * Put vertices at new positions. Unmoved interior neighbours slide so segments
 * stay orthogonal; wire ends never slide (they may be attached to something),
 * so a segment ending there gets a Z bend instead.
 */
export const placeWirePoints = (w: WireShape, placed: Map<number, Pt>): WireShape => {
  const orig = w.points;
  const last = orig.length - 1;
  const pts = orig.map((p, i) => ({ ...(placed.get(i) ?? p) }));
  for (const i of placed.keys()) {
    for (const j of [i - 1, i + 1]) {
      if (j <= 0 || j >= last || placed.has(j)) continue;
      if (isHorizontal(orig[i], orig[j])) pts[j].y = pts[i].y;
      else if (isVertical(orig[i], orig[j])) pts[j].x = pts[i].x;
    }
  }
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (isHorizontal(orig[i - 1], orig[i]) && a.y !== b.y) {
      const mx = (a.x + b.x) / 2;
      out.push({ x: mx, y: a.y }, { x: mx, y: b.y });
    } else if (isVertical(orig[i - 1], orig[i]) && a.x !== b.x) {
      const my = (a.y + b.y) / 2;
      out.push({ x: a.x, y: my }, { x: b.x, y: my });
    }
    out.push(b);
  }
  return { ...w, points: out };
};

/** Move some vertices; their unmoved neighbours slide so segments stay orthogonal. */
export const moveWirePoints = (w: WireShape, moves: WirePointMove[], dx: number, dy: number): WireShape => {
  const moved = new Map<number, WirePointMove>();
  for (const m of moves) {
    const prev = moved.get(m.i);
    moved.set(m.i, prev ? { i: m.i, mx: (prev.mx | m.mx) as 0 | 1, my: (prev.my | m.my) as 0 | 1 } : m);
  }
  const placed = new Map<number, Pt>();
  for (const m of moved.values()) placed.set(m.i, { x: w.points[m.i].x + dx * m.mx, y: w.points[m.i].y + dy * m.my });
  return placeWirePoints(w, placed);
};

/**
 * Snap wire ends that are attached to macro ports back onto those ports, e.g.
 * after the macro moved, was stretched or changed its number of inputs.
 * `skip` holds "wireId:start" / "wireId:end" for ends the user is dragging right now.
 */
export const syncConnections = (doc: Doc, skip: Set<string> = new Set()): Doc => {
  let shapes: Doc['shapes'] | null = null;
  for (const id of doc.order) {
    const w = doc.shapes[id];
    if (w?.type !== 'wire' || (!w.from && !w.to)) continue;
    const placed = new Map<number, Pt>();
    let { from, to } = w;
    const ends: [PortRef | undefined, number, 'from' | 'to'][] = [[from, 0, 'from'], [to, w.points.length - 1, 'to']];
    for (const [ref, i, which] of ends) {
      if (!ref || skip.has(`${id}:${which === 'from' ? 'start' : 'end'}`)) continue;
      const m = doc.shapes[ref.id];
      const p = m?.type === 'macro' ? portPosition(m, ref.port) : null;
      if (!p) {
        // Macro or port is gone: the wire end stays where it is, unattached.
        if (which === 'from') from = undefined;
        else to = undefined;
        continue;
      }
      if (p.x !== w.points[i].x || p.y !== w.points[i].y) placed.set(i, p);
    }
    if (!placed.size && from === w.from && to === w.to) continue;
    shapes ??= { ...doc.shapes };
    shapes[id] = { ...placeWirePoints(w, placed), from, to };
  }
  return shapes ? { ...doc, shapes } : doc;
};

/** Port at exactly this point, if any. */
export const portAt = (doc: Doc, p: Pt, tol = 0.5): PortRef | undefined => {
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const m = doc.shapes[doc.order[i]];
    if (m?.type !== 'macro') continue;
    const hit = macroPorts(m).find((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) <= tol);
    if (hit) return { id: m.id, port: hit.name };
  }
  return undefined;
};

/** Re-derive which ports a wire's ends are attached to from where they now are. */
export const bindConnections = (doc: Doc, wireIds: Iterable<string>): Doc => {
  const shapes = { ...doc.shapes };
  for (const id of wireIds) {
    const w = shapes[id];
    if (w?.type !== 'wire' || w.points.length < 2) continue;
    const from = portAt(doc, w.points[0]);
    const to = portAt(doc, w.points[w.points.length - 1]);
    const { from: _f, to: _t, ...rest } = w;
    shapes[id] = { ...rest, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return { ...doc, shapes };
};

export const applyTargets = (doc: Doc, targets: Target[], dx: number, dy: number): Doc => {
  const shapes = { ...doc.shapes };
  const dragged = new Set<string>();
  for (const t of targets) {
    const s = shapes[t.id];
    if (!s) continue;
    if (t.kind === 'move') {
      shapes[t.id] = translateShape(s, dx, dy);
      if (s.type === 'wire') dragged.add(`${t.id}:start`).add(`${t.id}:end`);
    } else if (t.kind === 'boxEdges' && isRectShape(s)) shapes[t.id] = stretchRect(s, t.edges, dx, dy);
    else if (t.kind === 'wirePoints' && s.type === 'wire') {
      shapes[t.id] = moveWirePoints(s, t.pts, dx, dy);
      for (const q of t.pts) {
        if (q.i === 0) dragged.add(`${t.id}:start`);
        if (q.i === s.points.length - 1) dragged.add(`${t.id}:end`);
      }
    }
  }
  return syncConnections({ ...doc, shapes }, dragged);
};

/** Tidy wires touched by a finished drag and record which ports their ends now sit on. */
export const finalizeTargets = (doc: Doc, targets: Target[]): Doc => {
  const shapes = { ...doc.shapes };
  const wires = new Set<string>();
  for (const t of targets) {
    const s = shapes[t.id];
    if (s?.type === 'wire') {
      shapes[t.id] = { ...s, points: simplifyPolyline(s.points) };
      wires.add(t.id);
    }
  }
  return bindConnections({ ...doc, shapes }, wires);
};

const onSegment = (p: Pt, a: Pt, b: Pt): boolean => distToSegment(p, a, b) < 0.01;

/** Which edges of the box does the point lie on? */
const edgesAt = (b: BoxShape, p: Pt): Edges => {
  const tl = { x: b.x, y: b.y }, tr = { x: b.x + b.w, y: b.y };
  const bl = { x: b.x, y: b.y + b.h }, br = { x: b.x + b.w, y: b.y + b.h };
  return { l: onSegment(p, tl, bl), r: onSegment(p, tr, br), t: onSegment(p, tl, tr), b: onSegment(p, bl, br) };
};

/**
 * Wire endpoints resting on a box edge that is about to move get dragged along,
 * so connections survive moves and stretches.
 */
export const attachedWireTargets = (doc: Doc, boxEdges: Map<string, Edges>, skip: Set<string>): Target[] => {
  const out: Target[] = [];
  for (const id of doc.order) {
    const w = doc.shapes[id];
    if (w?.type !== 'wire' || skip.has(id) || w.points.length < 2) continue;
    const pts: WirePointMove[] = [];
    for (const i of [0, w.points.length - 1]) {
      for (const [boxId, moving] of boxEdges) {
        const b = doc.shapes[boxId];
        if (b?.type !== 'box') continue;
        const on = edgesAt(b, w.points[i]);
        if (!(on.l || on.r || on.t || on.b)) continue;
        const mx = (on.l && moving.l) || (on.r && moving.r) || (moving.l && moving.r);
        const my = (on.t && moving.t) || (on.b && moving.b) || (moving.t && moving.b);
        if (mx || my) pts.push({ i, mx: mx ? 1 : 0, my: my ? 1 : 0 });
      }
    }
    if (pts.length) out.push({ kind: 'wirePoints', id, pts });
  }
  return out;
};

const ALL_EDGES: Edges = { l: true, r: true, t: true, b: true };

/** Targets for moving whole shapes, dragging attached wire ends along. */
export const moveTargets = (doc: Doc, ids: string[]): Target[] => {
  const set = new Set(ids);
  const boxes = new Map<string, Edges>();
  for (const id of ids) if (doc.shapes[id]?.type === 'box') boxes.set(id, ALL_EDGES);
  return [...ids.map((id): Target => ({ kind: 'move', id })), ...attachedWireTargets(doc, boxes, set)];
};

/** Stretch handle under the cursor: a box edge/corner, a wire vertex or a wire segment. */
export const pickStretch = (doc: Doc, p: Pt, tol: number, prefer?: Set<string>): Target[] | null => {
  let best: { d: number; t: Target; preferred: boolean } | null = null;
  const consider = (d: number, t: Target) => {
    if (d > tol) return;
    const preferred = prefer?.has(t.id) ?? false;
    if (!best || (preferred && !best.preferred) || (preferred === best.preferred && d < best.d)) {
      best = { d, t, preferred };
    }
  };
  for (const id of [...doc.order].reverse()) {
    const s = doc.shapes[id];
    if (isRectShape(s)) {
      const dl = Math.abs(p.x - s.x), dr = Math.abs(p.x - s.x - s.w);
      const dt = Math.abs(p.y - s.y), db = Math.abs(p.y - s.y - s.h);
      const inY = p.y >= s.y - tol && p.y <= s.y + s.h + tol;
      const inX = p.x >= s.x - tol && p.x <= s.x + s.w + tol;
      const e: Edges = {
        l: inY && dl <= tol && dl <= dr,
        r: inY && dr <= tol && dr < dl,
        t: inX && dt <= tol && dt <= db,
        b: inX && db <= tol && db < dt,
      };
      if (e.l || e.r || e.t || e.b) {
        const d = Math.min(e.l ? dl : Infinity, e.r ? dr : Infinity, e.t ? dt : Infinity, e.b ? db : Infinity);
        consider(d, { kind: 'boxEdges', id, edges: e });
      }
    } else if (s.type === 'wire') {
      const pts = s.points;
      // Vertices win over segments at equal distance.
      pts.forEach((q, i) => consider(Math.hypot(p.x - q.x, p.y - q.y) - tol * 0.01, { kind: 'wirePoints', id, pts: [{ i, mx: 1, my: 1 }] }));
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const d = distToSegment(p, a, b);
        const h = isHorizontal(a, b), v = isVertical(a, b);
        const mx = h ? 0 : 1, my = v ? 0 : 1;
        consider(d, { kind: 'wirePoints', id, pts: [{ i, mx, my }, { i: i + 1, mx, my }] });
      }
    } else {
      const r = shapeBounds(s);
      if (rectContains({ x: r.x - tol, y: r.y - tol, w: r.w + 2 * tol, h: r.h + 2 * tol }, p)) consider(tol, { kind: 'move', id });
    }
  }
  if (!best) return null;
  return withAttached(doc, [(best as { t: Target }).t]);
};

/** Area stretch: edges and vertices inside the rectangle move; fully enclosed shapes translate. */
export const areaStretch = (doc: Doc, area: Rect): Target[] => {
  const targets: Target[] = [];
  for (const id of doc.order) {
    const s = doc.shapes[id];
    if (isRectShape(s)) {
      const inX = (x: number) => x >= area.x && x <= area.x + area.w;
      const inY = (y: number) => y >= area.y && y <= area.y + area.h;
      const spanX = inX(s.x) && inX(s.x + s.w), spanY = inY(s.y) && inY(s.y + s.h);
      const e: Edges = { l: inX(s.x) && spanY, r: inX(s.x + s.w) && spanY, t: inY(s.y) && spanX, b: inY(s.y + s.h) && spanX };
      if (e.l || e.r || e.t || e.b) targets.push({ kind: 'boxEdges', id, edges: e });
    } else if (s.type === 'wire') {
      const pts = s.points.flatMap((p, i): WirePointMove[] => (rectContains(area, p) ? [{ i, mx: 1, my: 1 }] : []));
      if (pts.length === s.points.length) targets.push({ kind: 'move', id });
      else if (pts.length) targets.push({ kind: 'wirePoints', id, pts });
    } else if (rectInside(shapeBounds(s), area)) {
      targets.push({ kind: 'move', id });
    }
  }
  return withAttached(doc, targets);
};

const withAttached = (doc: Doc, targets: Target[]): Target[] => {
  const boxes = new Map<string, Edges>();
  const skip = new Set<string>();
  for (const t of targets) {
    if (t.kind === 'boxEdges') boxes.set(t.id, t.edges);
    else if (t.kind === 'move' && doc.shapes[t.id]?.type === 'box') boxes.set(t.id, ALL_EDGES);
    if (t.kind === 'move') skip.add(t.id);
  }
  const attached = attachedWireTargets(doc, boxes, skip);
  // Merge attached endpoint moves into existing wire targets.
  const out = [...targets];
  for (const a of attached) {
    if (a.kind !== 'wirePoints') continue;
    const existing = out.find((t): t is Extract<Target, { kind: 'wirePoints' }> => t.kind === 'wirePoints' && t.id === a.id);
    if (existing) existing.pts = [...existing.pts, ...a.pts];
    else out.push(a);
  }
  return out;
};

/** Expand ids to include every member of their groups. */
export const expandGroups = (doc: Doc, ids: Iterable<string>): string[] => {
  const set = new Set(ids);
  const groups = new Set<string>();
  for (const id of set) {
    const g = doc.shapes[id]?.groupId;
    if (g) groups.add(g);
  }
  if (groups.size) for (const id of doc.order) if (groups.has(doc.shapes[id].groupId ?? '')) set.add(id);
  return doc.order.filter((id) => set.has(id));
};

/** Duplicate shapes (keeping z-order), remapping group ids. Returns new doc and new ids. */
export const duplicate = (doc: Doc, ids: string[], dx: number, dy: number): { doc: Doc; ids: string[] } => {
  const groupMap = new Map<string, string>();
  const shapes = { ...doc.shapes };
  const order = [...doc.order];
  const created: string[] = [];
  const idMap = new Map<string, string>();
  for (const id of doc.order) if (ids.includes(id)) idMap.set(id, newId());
  for (const id of doc.order) {
    if (!ids.includes(id)) continue;
    const src = doc.shapes[id];
    const copy = translateShape({ ...src, id: idMap.get(id)! }, dx, dy);
    if (src.groupId) {
      if (!groupMap.has(src.groupId)) groupMap.set(src.groupId, newId('g'));
      copy.groupId = groupMap.get(src.groupId);
    }
    if (copy.type === 'wire') {
      // Copied wires stay attached only to macros copied along with them.
      const remap = (r?: PortRef) => (r && idMap.has(r.id) ? { id: idMap.get(r.id)!, port: r.port } : undefined);
      const { from, to, ...rest } = copy;
      const f = remap(from), t = remap(to);
      shapes[copy.id] = { ...rest, ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) };
    } else shapes[copy.id] = copy;
    order.push(copy.id);
    created.push(copy.id);
  }
  return { doc: { shapes, order }, ids: created };
};

export type Arrange = 'front' | 'back' | 'forward' | 'backward';

const overlaps = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/**
 * Change stacking order. Forward / backward step past the next shape that
 * actually overlaps the selection, so every keypress has a visible effect.
 */
export const arrange = (doc: Doc, ids: string[], how: Arrange): Doc => {
  const sel = new Set(ids.filter((id) => doc.shapes[id]));
  if (!sel.size) return doc;
  const picked = doc.order.filter((id) => sel.has(id));
  const rest = doc.order.filter((id) => !sel.has(id));
  if (how === 'front') return { ...doc, order: [...rest, ...picked] };
  if (how === 'back') return { ...doc, order: [...picked, ...rest] };

  const bounds = picked.map((id) => shapeBounds(doc.shapes[id]));
  const hits = (id: string) => bounds.some((b) => overlaps(b, shapeBounds(doc.shapes[id])));
  const idx = picked.map((id) => doc.order.indexOf(id));
  let insertAt: number; // position in `rest` the selection goes before
  if (how === 'forward') {
    const top = Math.max(...idx);
    const above = doc.order.slice(top + 1).filter((id) => !sel.has(id));
    const next = above.find(hits) ?? above[above.length - 1];
    if (!next) return doc;
    insertAt = rest.indexOf(next) + 1;
  } else {
    const bottom = Math.min(...idx);
    const below = doc.order.slice(0, bottom).filter((id) => !sel.has(id));
    const next = [...below].reverse().find(hits) ?? below[0];
    if (!next) return doc;
    insertAt = rest.indexOf(next);
  }
  return { ...doc, order: [...rest.slice(0, insertAt), ...picked, ...rest.slice(insertAt)] };
};
