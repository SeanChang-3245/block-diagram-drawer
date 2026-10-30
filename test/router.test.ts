import { describe, expect, it } from 'vitest';
import { route, rerouteWire, terminalAt, obstacles } from '../src/model/router';
import { MACRO_TEMPLATES } from '../src/model/macros';
import { defaultBox, defaultWire } from '../src/model/presets';
import type { Doc, MacroShape, Pt, Shape, WireShape } from '../src/model/types';

const box = (id: string, x: number, y: number, w: number, h: number): Shape => ({ ...defaultBox(), id, x, y, w, h });
const docOf = (...shapes: Shape[]): Doc => ({ shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) });
const orth = (pts: Pt[]) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const crosses = (pts: Pt[], r: { x: number; y: number; w: number; h: number }) =>
  pts.some((p, i) => {
    if (!i) return false;
    const a = pts[i - 1];
    const x0 = Math.min(a.x, p.x), x1 = Math.max(a.x, p.x), y0 = Math.min(a.y, p.y), y1 = Math.max(a.y, p.y);
    return x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h;
  });

describe('router', () => {
  it('goes around a block in the way, with few bends', () => {
    const wall = { x: 100, y: 0, w: 40, h: 100 };
    const pts = route({ p: { x: 0, y: 50 }, out: 0 }, { p: { x: 240, y: 50 }, out: 1 }, [wall])!;
    expect(orth(pts)).toBe(true);
    expect(crosses(pts, wall)).toBe(false);
    expect(pts[0]).toEqual({ x: 0, y: 50 });
    expect(pts.at(-1)).toEqual({ x: 240, y: 50 });
    expect(pts.length).toBeLessThanOrEqual(6);
  });

  it('is a straight line when nothing is in the way', () => {
    expect(route({ p: { x: 0, y: 50 }, out: 0 }, { p: { x: 200, y: 50 }, out: 1 }, [])).toEqual([{ x: 0, y: 50 }, { x: 200, y: 50 }]);
  });

  it('enters pins head-on, e.g. a MUX select from above', () => {
    const mux: MacroShape = { ...MACRO_TEMPLATES[0].make({ x: 200, y: 100 }, { inputs: 2 }), id: 'm' };
    const doc = docOf(box('src', 0, 0, 40, 40), mux);
    const w: WireShape = { ...defaultWire(), id: 'w', points: [{ x: 40, y: 20 }, { x: 210, y: 105 }], to: { id: 'm', port: 'sel' } };
    const r = rerouteWire(doc, w);
    expect(orth(r.points)).toBe(true);
    const [p, q] = r.points.slice(-2);
    expect(p.x).toBe(q.x); // vertical into the pin
    expect(p.y).toBeLessThan(q.y); // coming down from above
    expect(terminalAt(doc, { x: 40, y: 20 }).out).toBe(0); // leaves the box to the right
    expect(obstacles(doc)).toHaveLength(2);
  });
});
