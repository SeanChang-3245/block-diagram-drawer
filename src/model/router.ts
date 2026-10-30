// Obstacle-avoiding orthogonal wire routing.
//
// Candidate tracks run along every block edge (offset by a clearance), every
// pin and every wire end, plus the middle of each gap between blocks (a
// "Hanan grid"). A* over that grid finds the cheapest path, where cost is
// length plus a penalty per bend, so routes are short and have few corners.
// Ends sitting on a block leave it head-on through a short stub.

import { simplifyPolyline, type Rect } from './geometry';
import { macroPorts } from './macros';
import type { Doc, Pt, Shape, WireShape } from './types';

const CLEAR = 10; // tracks run this far outside blocks
const BEND = 30; // cost of one corner, in units of length
const STUB = 10; // straight run out of / into a pin

type Dir = 0 | 1 | 2 | 3; // +x, -x, +y, -y

/** Where a wire end sits and which way it must leave (or enter) its block. */
export interface Terminal {
  p: Pt;
  /** Outward direction from the block, or null for a free end. */
  out: Dir | null;
  /** The block it sits on; the stub runs out to its clearance line. */
  block?: Rect;
}

const blockOf = (s: Shape): Rect | null => (s.type === 'box' || s.type === 'macro' ? { x: s.x, y: s.y, w: s.w, h: s.h } : null);

/** Blocks wires should go around. */
export const obstacles = (doc: Doc, except: Set<string> = new Set()): Rect[] =>
  doc.order.flatMap((id) => {
    const r = except.has(id) ? null : blockOf(doc.shapes[id]);
    return r && r.w > 0 && r.h > 0 ? [r] : [];
  });

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Outward direction of a point on a block's border (null if it is not on one). */
const borderDir = (r: Rect, p: Pt): Dir | null => {
  const inY = p.y >= r.y - 0.01 && p.y <= r.y + r.h + 0.01;
  const inX = p.x >= r.x - 0.01 && p.x <= r.x + r.w + 0.01;
  if (inY && near(p.x, r.x)) return 1;
  if (inY && near(p.x, r.x + r.w)) return 0;
  if (inX && near(p.y, r.y)) return 3;
  if (inX && near(p.y, r.y + r.h)) return 2;
  return null;
};

/** Terminal for a wire end: from its pin if attached, else from the block border it rests on. */
export const terminalAt = (doc: Doc, p: Pt, ref?: WireShape['from']): Terminal => {
  const m = ref && doc.shapes[ref.id];
  if (m && m.type === 'macro') {
    const port = macroPorts(m).find((q) => q.name === ref!.port);
    if (port) {
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      const out: Dir = port.horizontal ? (port.p.x >= cx ? 0 : 1) : port.p.y >= cy ? 2 : 3;
      return { p: port.p, out, block: { x: m.x, y: m.y, w: m.w, h: m.h } };
    }
  }
  for (const id of doc.order) {
    const r = blockOf(doc.shapes[id]);
    const d = r && borderDir(r, p);
    if (r && d !== null && d !== undefined) return { p, out: d, block: r };
  }
  return { p, out: null };
};

const segBlocked = (a: Pt, b: Pt, rects: Rect[]): boolean => {
  // Blocks are inflated by just under the clearance so tracks along their edges stay free.
  const k = CLEAR - 0.5;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return rects.some((r) => x1 > r.x - k && x0 < r.x + r.w + k && y1 > r.y - k && y0 < r.y + r.h + k);
};

const uniqSorted = (v: number[]) => [...new Set(v.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);

/** Small binary heap keyed on f-cost. */
class Heap {
  private a: { f: number; k: number }[] = [];
  push(f: number, k: number) {
    const a = this.a;
    a.push({ f, k });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0].k;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/** End of the straight run out of a block: just past its clearance (pins may sit inside the bbox). */
const step = (t: Terminal): Pt => {
  if (t.out === null) return t.p;
  const b = t.block;
  switch (t.out) {
    case 0:
      return { x: Math.max(t.p.x + STUB, b ? b.x + b.w + CLEAR : -Infinity), y: t.p.y };
    case 1:
      return { x: Math.min(t.p.x - STUB, b ? b.x - CLEAR : Infinity), y: t.p.y };
    case 2:
      return { x: t.p.x, y: Math.max(t.p.y + STUB, b ? b.y + b.h + CLEAR : -Infinity) };
    case 3:
      return { x: t.p.x, y: Math.min(t.p.y - STUB, b ? b.y - CLEAR : Infinity) };
  }
};

/**
 * Orthogonal route from one terminal to another around the blocks, or null
 * if no route exists (the caller then falls back to a simple bend).
 */
export const route = (from: Terminal, to: Terminal, rects: Rect[]): Pt[] | null => {
  const s = step(from), t = step(to);
  const xs: number[] = [s.x, t.x], ys: number[] = [s.y, t.y];
  for (const r of rects) {
    xs.push(r.x - CLEAR, r.x + r.w + CLEAR);
    ys.push(r.y - CLEAR, r.y + r.h + CLEAR);
  }
  // Channel centres between neighbouring tracks give routes room to breathe.
  const addMids = (v: number[]) => {
    const u = uniqSorted(v);
    for (let i = 0; i + 1 < u.length; i++) if (u[i + 1] - u[i] > 4 * CLEAR) v.push(Math.round((u[i] + u[i + 1]) / 20) * 10);
    return uniqSorted(v);
  };
  const X = addMids(xs), Y = addMids(ys);
  const nx = X.length, ny = Y.length;
  const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i]));
  const key = (i: number, j: number, d: number) => (i * ny + j) * 4 + d;
  const si = xi.get(Math.round(s.x * 100) / 100)!, sj = yi.get(Math.round(s.y * 100) / 100)!;
  const ti = xi.get(Math.round(t.x * 100) / 100)!, tj = yi.get(Math.round(t.y * 100) / 100)!;
  // The stub points themselves must be reachable; the blocks they leave are not crossed by the stubs.
  const blocked = (a: Pt, b: Pt) => segBlocked(a, b, rects);

  const g = new Float64Array(nx * ny * 4).fill(Infinity);
  const prev = new Int32Array(nx * ny * 4).fill(-1);
  const heap = new Heap();
  const h = (i: number, j: number) => Math.abs(X[i] - X[ti]) + Math.abs(Y[j] - Y[tj]);
  // Leaving the start stub, continuing straight is free; any other initial heading costs a bend.
  for (let d = 0 as Dir; d < 4; d++) {
    if (from.out !== null && (d ^ 1) === from.out) continue; // no doubling back into the block
    const c = from.out === null || d === from.out ? 0 : BEND;
    const k = key(si, sj, d);
    g[k] = c;
    heap.push(c + h(si, sj), k);
  }
  let goal = -1;
  let guard = 0;
  while (heap.size && guard++ < 200000) {
    const k = heap.pop()!;
    const d = (k % 4) as Dir, cell = (k - d) / 4, i = Math.floor(cell / ny), j = cell % ny;
    if (i === ti && j === tj) {
      // Arriving must not come out of the target block's side.
      if (to.out === null || d === (to.out ^ 1)) {
        goal = k;
        break;
      }
    }
    const here = { x: X[i], y: Y[j] };
    for (let nd = 0 as Dir; nd < 4; nd++) {
      if ((nd ^ 1) === d) continue; // no U-turns in place
      const ni = i + (nd === 0 ? 1 : nd === 1 ? -1 : 0), nj = j + (nd === 2 ? 1 : nd === 3 ? -1 : 0);
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const there = { x: X[ni], y: Y[nj] };
      if (blocked(here, there)) continue;
      const cost = g[k] + Math.abs(there.x - here.x) + Math.abs(there.y - here.y) + (nd === d ? 0 : BEND);
      const nk = key(ni, nj, nd);
      if (cost < g[nk]) {
        g[nk] = cost;
        prev[nk] = k;
        heap.push(cost + h(ni, nj), nk);
      }
    }
  }
  if (goal < 0) return null;
  const path: Pt[] = [];
  for (let k = goal; k >= 0; k = prev[k]) {
    const cell = (k - (k % 4)) / 4;
    path.push({ x: X[Math.floor(cell / ny)], y: Y[cell % ny] });
  }
  path.reverse();
  return simplifyPolyline([from.p, ...path, to.p]);
};

/** Re-route a wire between its current ends (keeping them), avoiding all blocks. */
export const rerouteWire = (doc: Doc, w: WireShape): WireShape => {
  if (w.points.length < 2) return w;
  const a = terminalAt(doc, w.points[0], w.from);
  const b = terminalAt(doc, w.points[w.points.length - 1], w.to);
  const pts = route(a, b, obstacles(doc));
  return pts && pts.length >= 2 ? { ...w, points: pts } : w;
};

/**
 * After blocks moved or changed shape, re-route the wires attached to them
 * (by pin or by resting on their border). Wires the user shaped by hand
 * (`manual`) and wires in `skip` keep their route.
 */
export const rerouteAffected = (doc: Doc, changed: Set<string>, skip: Set<string> = new Set()): Doc => {
  if (!changed.size) return doc;
  const blocks = [...changed].flatMap((id) => {
    const r = doc.shapes[id] && blockOf(doc.shapes[id]);
    return r ? [r] : [];
  });
  const touches = (w: WireShape) =>
    (w.from && changed.has(w.from.id)) ||
    (w.to && changed.has(w.to.id)) ||
    [w.points[0], w.points[w.points.length - 1]].some((p) => blocks.some((r) => borderDir(r, p) !== null));
  let shapes: Doc['shapes'] | null = null;
  for (const id of doc.order) {
    const w = doc.shapes[id];
    if (w?.type !== 'wire' || w.manual || skip.has(id) || w.points.length < 2 || !touches(w)) continue;
    shapes ??= { ...doc.shapes };
    shapes[id] = rerouteWire(doc, w);
  }
  return shapes ? { ...doc, shapes } : doc;
};
