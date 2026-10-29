import { describe, expect, it } from 'vitest';
import { applyTargets, areaStretch, duplicate, finalizeTargets, moveTargets, pickStretch } from '../src/model/edits';
import { defaultBox, defaultWire } from '../src/model/presets';
import type { BoxShape, Doc, Shape, WireShape } from '../src/model/types';

const box = (id: string, x: number, y: number, w: number, h: number): BoxShape => ({ ...defaultBox(), id, x, y, w, h });
const wire = (id: string, pts: [number, number][]): WireShape => ({ ...defaultWire(), id, points: pts.map(([x, y]) => ({ x, y })) });
const docOf = (...shapes: Shape[]): Doc => ({ shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) });

describe('stretch', () => {
  it('picks the right edge of a box and resizes it, dragging attached wire ends', () => {
    // a: 0..100 wide; wire leaves its right edge at y=20 and bends down to b.
    const doc = docOf(box('a', 0, 0, 100, 40), wire('w', [[100, 20], [150, 20], [150, 80]]));
    const targets = pickStretch(doc, { x: 101, y: 10 }, 5)!;
    expect(targets[0]).toMatchObject({ kind: 'boxEdges', id: 'a', edges: { r: true, l: false } });
    const out = applyTargets(doc, targets, 30, 999);
    expect(out.shapes.a).toMatchObject({ x: 0, w: 130, h: 40 });
    // Endpoint follows the edge in x only; the wire stays orthogonal.
    expect((out.shapes.w as WireShape).points).toEqual([{ x: 130, y: 20 }, { x: 150, y: 20 }, { x: 150, y: 80 }]);
  });

  it('picks a corner as two edges', () => {
    const doc = docOf(box('a', 0, 0, 100, 40));
    const t = pickStretch(doc, { x: 99, y: 41 }, 5)![0];
    expect(t).toMatchObject({ kind: 'boxEdges', edges: { r: true, b: true, l: false, t: false } });
    expect(applyTargets(doc, [t], 10, 10).shapes.a).toMatchObject({ w: 110, h: 50 });
  });

  it('never shrinks a box below the grid size', () => {
    const doc = docOf(box('a', 0, 0, 100, 40));
    const t = pickStretch(doc, { x: 0, y: 20 }, 5)!;
    expect(applyTargets(doc, t, 500, 0).shapes.a).toMatchObject({ x: 90, w: 10 });
  });

  it('slides a horizontal wire segment vertically and keeps neighbours orthogonal', () => {
    const doc = docOf(wire('w', [[0, 0], [50, 0], [50, 40], [100, 40]]));
    const t = pickStretch(doc, { x: 75, y: 41 }, 5)!;
    const pts = (applyTargets(doc, t, 13, 20).shapes.w as WireShape).points;
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 60 }]);
  });

  it('area stretch moves enclosed edges and vertices only', () => {
    const doc = docOf(box('a', 0, 0, 100, 40), box('b', 200, 0, 50, 40), wire('w', [[100, 20], [200, 20]]));
    // Area grabs a's right edge, the whole wire and b entirely.
    const targets = areaStretch(doc, { x: 90, y: -10, w: 200, h: 60 });
    const out = finalizeTargets(applyTargets(doc, targets, 20, 0), targets);
    expect(out.shapes.a).toMatchObject({ x: 0, w: 120 });
    expect(out.shapes.b).toMatchObject({ x: 220, w: 50 });
    expect((out.shapes.w as WireShape).points).toEqual([{ x: 120, y: 20 }, { x: 220, y: 20 }]);
  });
});

describe('move and copy', () => {
  it('moving a box drags wire endpoints on its border', () => {
    const doc = docOf(box('a', 0, 0, 100, 40), wire('w', [[100, 20], [200, 20], [200, 100]]));
    const out = applyTargets(doc, moveTargets(doc, ['a']), 0, 10);
    expect((out.shapes.w as WireShape).points).toEqual([{ x: 100, y: 30 }, { x: 200, y: 30 }, { x: 200, y: 100 }]);
  });

  it('duplicate gives fresh ids and remaps groups', () => {
    const doc = docOf({ ...box('a', 0, 0, 10, 10), groupId: 'g1' }, { ...box('b', 20, 0, 10, 10), groupId: 'g1' });
    const { doc: out, ids } = duplicate(doc, ['a', 'b'], 5, 5);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain('a');
    const [c, d] = ids.map((id) => out.shapes[id]);
    expect(c.groupId).toBe(d.groupId);
    expect(c.groupId).not.toBe('g1');
    expect(c).toMatchObject({ x: 5, y: 5 });
  });
});
