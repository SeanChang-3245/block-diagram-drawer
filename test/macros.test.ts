import { describe, expect, it } from 'vitest';
import { MACRO_TEMPLATES, macroPorts, portPosition } from '../src/model/macros';
import { applyTargets, arrange, bindConnections, duplicate, finalizeTargets, moveTargets, pickStretch, syncConnections } from '../src/model/edits';
import { findJunctions } from '../src/model/junctions';
import { pointAlong, projectOnto } from '../src/model/geometry';
import { defaultBox, defaultWire } from '../src/model/presets';
import type { Doc, MacroShape, Shape, WireShape } from '../src/model/types';

const make = (kind: MacroShape['kind'], x = 0, y = 0, inputs = 2, id = kind): MacroShape => ({
  ...MACRO_TEMPLATES.find((t) => t.kind === kind)!.make({ x, y }, { inputs }),
  id,
});
const wire = (id: string, pts: [number, number][]): WireShape => ({ ...defaultWire(), id, points: pts.map(([x, y]) => ({ x, y })) });
const docOf = (...shapes: Shape[]): Doc => ({ shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) });

describe('macro geometry', () => {
  it.each([2, 3, 5, 6, 7])('a %i-input MUX has evenly spaced inputs on the grid', (n) => {
    const m = make('mux', 100, 200, n);
    const ins = macroPorts(m).filter((p) => p.role === 'in');
    expect(ins).toHaveLength(n);
    for (const p of ins) {
      expect(p.p.x).toBe(100);
      expect(p.p.y % 10).toBe(0);
    }
    expect(portPosition(m, 'out')).toEqual({ x: 120, y: 200 + n * 10 });
  });

  it('default ports of every macro sit on the grid (except slanted control pins)', () => {
    for (const t of MACRO_TEMPLATES) {
      const m = { ...t.make({ x: 0, y: 0 }, { inputs: 3 }), id: t.kind };
      for (const p of macroPorts(m)) {
        if (p.role === 'ctrl' && (m.kind === 'mux' || m.kind === 'alu')) continue;
        expect([p.p.x % 10, p.p.y % 10], `${m.kind}.${p.name}`).toEqual([0, 0]);
      }
    }
  });

  it('rotating the flow moves inputs to the top', () => {
    const m = { ...make('mux', 0, 0, 2), dir: 'down' as const, w: 40, h: 20 };
    const ins = macroPorts(m).filter((p) => p.role === 'in');
    expect(ins.every((p) => p.p.y === 0)).toBe(true);
    expect(portPosition(m, 'out')).toEqual({ x: 20, y: 20 });
  });
});

describe('connections', () => {
  const setup = () => {
    const mux = make('mux', 100, 0, 2); // in0 (100,10), in1 (100,30), out (120,20)
    const w = wire('w', [[40, 10], [100, 10]]);
    return bindConnections(docOf(mux, w), ['w']);
  };

  it('binds wire ends that sit on a port', () => {
    expect((setup().shapes.w as WireShape).to).toEqual({ id: 'mux', port: 'in0' });
  });

  it('attached wire ends follow a moved macro and stay orthogonal', () => {
    const doc = setup();
    const out = applyTargets(doc, moveTargets(doc, ['mux']), 0, 50);
    const pts = (out.shapes.w as WireShape).points;
    expect(pts[0]).toEqual({ x: 40, y: 10 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 60 });
    for (let i = 0; i + 1 < pts.length; i++) expect(pts[i].x === pts[i + 1].x || pts[i].y === pts[i + 1].y).toBe(true);
  });

  it('stretching a MUX re-spaces its inputs and the wires follow', () => {
    const doc = docOf(make('mux', 100, 0, 2), wire('a', [[40, 10], [100, 10]]), wire('b', [[40, 30], [100, 30]]));
    const bound = bindConnections(doc, ['a', 'b']);
    const t = pickStretch(bound, { x: 110, y: 40 }, 3)!; // bottom edge
    const out = applyTargets(bound, t, 0, 40); // height 40 -> 80
    expect((out.shapes.mux as MacroShape).h).toBe(80);
    expect((out.shapes.b as WireShape).points.at(-1)).toEqual({ x: 100, y: 60 });
    expect((out.shapes.a as WireShape).points.at(-1)).toEqual({ x: 100, y: 20 });
  });

  it('a removed port detaches the wire instead of moving it', () => {
    const doc = bindConnections(docOf(make('mux', 100, 0, 3), wire('w', [[40, 50], [100, 50]])), ['w']);
    expect((doc.shapes.w as WireShape).to?.port).toBe('in2');
    const fewer = syncConnections({ ...doc, shapes: { ...doc.shapes, mux: { ...(doc.shapes.mux as MacroShape), inputs: 2 } } });
    expect((fewer.shapes.w as WireShape).to).toBeUndefined();
    expect((fewer.shapes.w as WireShape).points.at(-1)).toEqual({ x: 100, y: 50 });
  });

  it('dragging a wire end off a port detaches it', () => {
    const doc = setup();
    const t = pickStretch(doc, { x: 100, y: 10 }, 3)!.filter((x) => x.id === 'w');
    const out = finalizeTargets(applyTargets(doc, t, -20, 0), t);
    expect((out.shapes.w as WireShape).to).toBeUndefined();
  });

  it('copies keep connections only to copied macros', () => {
    const doc = setup();
    const alone = duplicate(doc, ['w'], 0, 100);
    expect((alone.doc.shapes[alone.ids[0]] as WireShape).to).toBeUndefined();
    const both = duplicate(doc, ['mux', 'w'], 0, 100);
    const [mId, wId] = both.ids;
    expect((both.doc.shapes[wId] as WireShape).to).toEqual({ id: mId, port: 'in0' });
  });
});

describe('arrange', () => {
  const doc = docOf(
    { ...defaultBox(), id: 'a', x: 0, y: 0, w: 50, h: 50 },
    { ...defaultBox(), id: 'far', x: 500, y: 500, w: 10, h: 10 },
    { ...defaultBox(), id: 'b', x: 20, y: 20, w: 50, h: 50 },
  );
  it('front / back', () => {
    expect(arrange(doc, ['a'], 'front').order).toEqual(['far', 'b', 'a']);
    expect(arrange(doc, ['b'], 'back').order).toEqual(['b', 'a', 'far']);
  });
  it('forward steps past the next overlapping shape', () => {
    expect(arrange(doc, ['a'], 'forward').order).toEqual(['far', 'b', 'a']);
    expect(arrange(doc, ['b'], 'backward').order).toEqual(['b', 'a', 'far']);
  });
});

describe('junctions and labels', () => {
  it('dots a T-junction but not a corner', () => {
    const doc = docOf(wire('main', [[0, 0], [100, 0]]), wire('tap', [[50, 0], [50, 50]]), wire('end', [[100, 0], [100, 50]]));
    const j = findJunctions(doc);
    expect(j.map((x) => x.p)).toEqual([{ x: 50, y: 0 }]);
  });

  it('label position round-trips through projection', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(pointAlong(pts, 0.75).p).toEqual({ x: 100, y: 50 });
    expect(projectOnto(pts, { x: 108, y: 50 })).toBeCloseTo(0.75);
  });
});
