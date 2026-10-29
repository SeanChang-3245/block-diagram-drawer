import { distToSegment } from './geometry';
import type { Doc, Pt } from './types';

export interface Junction {
  p: Pt;
  r: number;
  color: string;
}

const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/**
 * T-junctions: a wire end that lands on the middle of another wire (not on one
 * of its ends) gets a dot. Derived on every render, so dots appear and vanish
 * as wires are edited. Spots already marked by a junction dot shape are skipped.
 */
export const findJunctions = (doc: Doc): Junction[] => {
  const wires = doc.order.map((id) => doc.shapes[id]).filter((s) => s?.type === 'wire');
  const existing = doc.order.map((id) => doc.shapes[id]).filter((s) => s?.type === 'dot');
  const out: Junction[] = [];
  for (const w of wires) {
    if (w.type !== 'wire' || w.points.length < 2) continue;
    for (const e of [w.points[0], w.points[w.points.length - 1]]) {
      if (out.some((j) => same(j.p, e))) continue;
      if (existing.some((d) => d.type === 'dot' && Math.hypot(d.x - e.x, d.y - e.y) <= d.r)) continue;
      const host = wires.find((o) => {
        if (o === w || o.type !== 'wire' || o.points.length < 2) return false;
        if (same(o.points[0], e) || same(o.points[o.points.length - 1], e)) return false;
        for (let i = 0; i + 1 < o.points.length; i++) if (distToSegment(e, o.points[i], o.points[i + 1]) < 0.01) return true;
        return false;
      });
      if (host && host.type === 'wire') out.push({ p: e, r: Math.max(2.2, host.stroke.width * 2), color: host.stroke.color });
    }
  }
  return out;
};
