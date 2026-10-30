import { describe, expect, it } from 'vitest';
import { alignShapes, straightenWire } from '../src/model/tidy';
import { defaultBox, defaultWire } from '../src/model/presets';
import type { Doc, Shape, WireShape } from '../src/model/types';

const box = (id: string, x: number, y: number, w = 40, h = 20, groupId?: string): Shape => ({ ...defaultBox(), id, x, y, w, h, ...(groupId ? { groupId } : {}) });
const wire = (id: string, pts: [number, number][]): WireShape => ({ ...defaultWire(), id, points: pts.map(([x, y]) => ({ x, y })) });
const docOf = (...shapes: Shape[]): Doc => ({ shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) });

describe('align', () => {
  it('aligns to the first selected shape, which stays put', () => {
    const doc = docOf(box('a', 100, 50), box('b', 0, 0), box('c', 30, 200, 80, 40));
    const { doc: out } = alignShapes(doc, ['a', 'b', 'c'], 'left');
    expect([out.shapes.a, out.shapes.b, out.shapes.c].map((s) => (s as { x: number }).x)).toEqual([100, 100, 100]);
    const v = alignShapes(doc, ['c', 'a'], 'vcenter').doc;
    expect(v.shapes.a).toMatchObject({ x: 50 }); // centre 70 like c
    const h = alignShapes(doc, ['a', 'c'], 'hcenter').doc;
    expect(h.shapes.c).toMatchObject({ y: 40 }); // centre 60 like a
  });

  it('distributes with equal gaps and moves a group as one', () => {
    const doc = docOf(box('a', 0, 0), box('b', 50, 0), box('g1', 150, 0, 20, 20, 'g'), box('g2', 170, 0, 20, 20, 'g'), box('c', 300, 0));
    const { doc: out } = alignShapes(doc, ['a', 'b', 'g1', 'c'], 'distribute');
    // span 0..340, widths 40+40+40+40 = 160, gap = 60
    expect((out.shapes.b as { x: number }).x).toBe(100);
    expect((out.shapes.g1 as { x: number }).x).toBe(200);
    expect((out.shapes.g2 as { x: number }).x).toBe(220);
    expect((out.shapes.c as { x: number }).x).toBe(300);
  });

  it('attached wires follow aligned blocks', () => {
    const doc = docOf(box('a', 0, 0), box('b', 100, 30), wire('w', [[40, 10], [70, 10], [70, 40], [100, 40]]));
    const { doc: out } = alignShapes(doc, ['a', 'b'], 'top');
    expect((out.shapes.w as WireShape).points.at(-1)).toEqual({ x: 100, y: 10 });
  });
});

describe('straighten', () => {
  it('removes a short jog without moving the ends', () => {
    const w = wire('w', [[0, 0], [50, 0], [50, 10], [100, 10], [100, 80]]);
    expect(straightenWire(w).points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }]);
  });
  it('leaves long jogs and fixed-end Z shapes alone', () => {
    const long = wire('a', [[0, 0], [50, 0], [50, 60], [100, 60], [100, 100]]);
    expect(straightenWire(long)).toBe(long);
    const z = wire('z', [[0, 0], [50, 0], [50, 10], [100, 10]]);
    expect(straightenWire(z)).toBe(z);
  });
});
