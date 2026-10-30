// Tidy-up commands: align / distribute blocks, straighten small wire jogs.

import { applyTargets, expandGroups, finalizeTargets, moveTargets } from './edits';
import { isHorizontal, isVertical, shapeBounds, simplifyPolyline, unionRects, type Rect } from './geometry';
import type { Doc, Pt, WireShape } from './types';

export type AlignHow = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter' | 'distribute';

/** Selected shapes grouped into units that move together (a group is one unit), wires excluded. */
const unitsOf = (doc: Doc, selection: string[]): { ids: string[]; r: Rect }[] => {
  const seen = new Set<string>();
  const units: { ids: string[]; r: Rect }[] = [];
  for (const id of selection) {
    const s = doc.shapes[id];
    if (!s || s.type === 'wire' || seen.has(id)) continue;
    const ids = expandGroups(doc, [id]).filter((x) => doc.shapes[x].type !== 'wire');
    ids.forEach((x) => seen.add(x));
    units.push({ ids, r: unionRects(ids.map((x) => shapeBounds(doc.shapes[x])))! });
  }
  return units;
};

/**
 * Align to the first selected unit (it stays put), or spread the units so the
 * gaps between them are equal along the axis they are most spread out on.
 * Attached wires follow, as in a move.
 */
export const alignShapes = (doc: Doc, selection: string[], how: AlignHow): { doc: Doc; moved: string[] } => {
  const units = unitsOf(doc, selection);
  const moves: { ids: string[]; dx: number; dy: number }[] = [];
  if (how === 'distribute') {
    if (units.length < 3) return { doc, moved: [] };
    const cx = units.map((u) => u.r.x + u.r.w / 2), cy = units.map((u) => u.r.y + u.r.h / 2);
    const horizontal = Math.max(...cx) - Math.min(...cx) >= Math.max(...cy) - Math.min(...cy);
    const sorted = [...units].sort((a, b) => (horizontal ? a.r.x - b.r.x : a.r.y - b.r.y));
    const size = (u: (typeof units)[0]) => (horizontal ? u.r.w : u.r.h);
    const start = (u: (typeof units)[0]) => (horizontal ? u.r.x : u.r.y);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = start(last) + size(last) - start(first);
    const gap = (span - sorted.reduce((t, u) => t + size(u), 0)) / (sorted.length - 1);
    let at = start(first);
    for (const u of sorted) {
      const d = Math.round(at - start(u));
      if (d) moves.push({ ids: u.ids, dx: horizontal ? d : 0, dy: horizontal ? 0 : d });
      at += size(u) + gap;
    }
  } else {
    if (units.length < 2) return { doc, moved: [] };
    const ref = units[0].r;
    for (const u of units.slice(1)) {
      const r = u.r;
      const d =
        how === 'left' ? { dx: ref.x - r.x, dy: 0 }
        : how === 'right' ? { dx: ref.x + ref.w - (r.x + r.w), dy: 0 }
        : how === 'top' ? { dx: 0, dy: ref.y - r.y }
        : how === 'bottom' ? { dx: 0, dy: ref.y + ref.h - (r.y + r.h) }
        : how === 'hcenter' ? { dx: 0, dy: ref.y + ref.h / 2 - (r.y + r.h / 2) }
        : { dx: ref.x + ref.w / 2 - (r.x + r.w / 2), dy: 0 };
      if (d.dx || d.dy) moves.push({ ids: u.ids, ...d });
    }
  }
  let next = doc;
  for (const m of moves) {
    const t = moveTargets(next, m.ids);
    next = finalizeTargets(applyTargets(next, t, m.dx, m.dy), t);
  }
  return { doc: next, moved: moves.flatMap((m) => m.ids) };
};

const JOG = 20; // jogs this short or shorter get straightened

/** Remove short jogs between parallel runs, never moving the wire's ends. */
export const straightenWire = (w: WireShape): WireShape => {
  let pts: Pt[] = simplifyPolyline(w.points);
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (let i = 1; i + 2 < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1], d = pts[i + 2];
      const len = Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
      if (len === 0 || len > JOG) continue;
      const hRuns = isHorizontal(a, b) && isHorizontal(c, d) && isVertical(b, c);
      const vRuns = isVertical(a, b) && isVertical(c, d) && isHorizontal(b, c);
      if (!hRuns && !vRuns) continue;
      const lastIdx = pts.length - 1;
      const next = pts.map((p) => ({ ...p }));
      // Move whichever neighbouring run does not end at a wire end.
      if (i + 2 !== lastIdx) {
        if (hRuns) next[i + 1].y = next[i + 2].y = b.y;
        else next[i + 1].x = next[i + 2].x = b.x;
      } else if (i - 1 !== 0) {
        if (hRuns) next[i - 1].y = next[i].y = c.y;
        else next[i - 1].x = next[i].x = c.x;
      } else continue;
      pts = simplifyPolyline(next);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return pts.length === w.points.length && pts.every((p, i) => p.x === w.points[i].x && p.y === w.points[i].y) ? w : { ...w, points: pts };
};
