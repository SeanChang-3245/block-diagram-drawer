// Move / stretch engine. A drag is described as a list of targets that are
// re-applied to the snapshot taken when the drag started, so previews never
// accumulate rounding.

import { GRID } from './presets';
import { distToSegment, isHorizontal, isVertical, rectContains, rectInside, shapeBounds, simplifyPolyline, type Rect } from './geometry';
import { newId, type BoxShape, type Doc, type Pt, type Shape, type WireShape } from './types';

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

const translateShape = (s: Shape, dx: number, dy: number): Shape => {
  switch (s.type) {
    case 'box':
    case 'text':
    case 'dot':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'wire':
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'raw':
      return { ...s, dx: s.dx + dx, dy: s.dy + dy };
  }
};

const stretchBox = (b: BoxShape, e: Edges, dx: number, dy: number): BoxShape => {
  let { x, y, w, h } = b;
  if (e.l && e.r) x += dx;
  else if (e.l) {
    const d = Math.min(dx, w - MIN_BOX);
    x += d;
    w -= d;
  } else if (e.r) w = Math.max(MIN_BOX, w + dx);
  if (e.t && e.b) y += dy;
  else if (e.t) {
    const d = Math.min(dy, h - MIN_BOX);
    y += d;
    h -= d;
  } else if (e.b) h = Math.max(MIN_BOX, h + dy);
  return { ...b, x, y, w, h };
};

/** Move some vertices; their unmoved neighbours slide so segments stay orthogonal. */
export const moveWirePoints = (w: WireShape, moves: WirePointMove[], dx: number, dy: number): WireShape => {
  const orig = w.points;
  const pts = orig.map((p) => ({ ...p }));
  const moved = new Map<number, WirePointMove>();
  for (const m of moves) {
    const prev = moved.get(m.i);
    moved.set(m.i, prev ? { i: m.i, mx: (prev.mx | m.mx) as 0 | 1, my: (prev.my | m.my) as 0 | 1 } : m);
  }
  for (const m of moved.values()) {
    pts[m.i] = { x: orig[m.i].x + dx * m.mx, y: orig[m.i].y + dy * m.my };
  }
  for (const m of moved.values()) {
    for (const j of [m.i - 1, m.i + 1]) {
      if (j < 0 || j >= orig.length || moved.has(j)) continue;
      if (isHorizontal(orig[m.i], orig[j])) pts[j].y = pts[m.i].y;
      else if (isVertical(orig[m.i], orig[j])) pts[j].x = pts[m.i].x;
    }
  }
  return { ...w, points: pts };
};

export const applyTargets = (doc: Doc, targets: Target[], dx: number, dy: number): Doc => {
  const shapes = { ...doc.shapes };
  for (const t of targets) {
    const s = shapes[t.id];
    if (!s) continue;
    if (t.kind === 'move') shapes[t.id] = translateShape(s, dx, dy);
    else if (t.kind === 'boxEdges' && s.type === 'box') shapes[t.id] = stretchBox(s, t.edges, dx, dy);
    else if (t.kind === 'wirePoints' && s.type === 'wire') shapes[t.id] = moveWirePoints(s, t.pts, dx, dy);
  }
  return { ...doc, shapes };
};

/** Tidy wires touched by a finished drag. */
export const finalizeTargets = (doc: Doc, targets: Target[]): Doc => {
  const shapes = { ...doc.shapes };
  for (const t of targets) {
    const s = shapes[t.id];
    if (s?.type === 'wire') shapes[t.id] = { ...s, points: simplifyPolyline(s.points) };
  }
  return { ...doc, shapes };
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
    if (s.type === 'box') {
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
    if (s.type === 'box') {
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
  for (const id of doc.order) {
    if (!ids.includes(id)) continue;
    const src = doc.shapes[id];
    const copy = translateShape({ ...src, id: newId() }, dx, dy);
    if (src.groupId) {
      if (!groupMap.has(src.groupId)) groupMap.set(src.groupId, newId('g'));
      copy.groupId = groupMap.get(src.groupId);
    }
    shapes[copy.id] = copy;
    order.push(copy.id);
    created.push(copy.id);
  }
  return { doc: { shapes, order }, ids: created };
};
