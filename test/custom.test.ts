import { describe, expect, it } from 'vitest';
import { explodeCustom, makeCustomMacro } from '../src/model/custom';
import { applyTargets, bindConnections, moveTargets } from '../src/model/edits';
import { macroPorts } from '../src/model/macros';
import { defaultBox, defaultWire } from '../src/model/presets';
import { exportSvg } from '../src/io/exportSvg';
import { importSvg } from '../src/io/importSvg';
import type { Doc, MacroShape, Shape, WireShape } from '../src/model/types';

const box = (id: string, x: number, y: number, w: number, h: number): Shape => ({ ...defaultBox(), id, x, y, w, h, text: 'Cache' });
const wire = (id: string, pts: [number, number][], label?: string): WireShape => ({
  ...defaultWire(),
  id,
  points: pts.map(([x, y]) => ({ x, y })),
  ...(label ? { label } : {}),
});
const docOf = (...shapes: Shape[]): Doc => ({ shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) });

// A cache box with an input stub on the left, an output stub on the right, and an
// outside wire already ending on the output stub's free end.
const cache = () =>
  docOf(
    box('c', 100, 100, 80, 60),
    wire('in', [[80, 130], [100, 130]], 'addr'),
    wire('out', [[180, 130], [200, 130]], 'data'),
    wire('ext', [[200, 130], [300, 130]]),
  );

describe('custom macros', () => {
  it('pins come from the free ends of stubs, named after their labels', () => {
    const r = makeCustomMacro(cache(), ['c', 'in', 'out'], 'L1$');
    if (!r.ok) throw new Error(r.error);
    expect(r.def.ports).toEqual([
      { name: 'addr', x: 0, y: 30, horizontal: true },
      { name: 'data', x: 120, y: 30, horizontal: true },
    ]);
    expect(r.instance).toMatchObject({ kind: 'custom', x: 80, y: 100, w: 120, h: 60, label: 'L1$' });
    // The selected shapes are replaced; the outside wire is now attached to the pin.
    expect(r.doc.order).toEqual([r.instance.id, 'ext']);
    expect((r.doc.shapes.ext as WireShape).from).toEqual({ id: r.instance.id, port: 'data' });
  });

  it('attached wires follow the instance, and it survives save / open', () => {
    const r = makeCustomMacro(cache(), ['c', 'in', 'out'], 'L1$');
    if (!r.ok) throw new Error(r.error);
    const moved = applyTargets(r.doc, moveTargets(r.doc, [r.instance.id]), 0, 40);
    expect((moved.shapes.ext as WireShape).points[0]).toEqual({ x: 200, y: 170 });
    const again = importSvg(exportSvg(moved)).doc;
    const inst = again.shapes[r.instance.id] as MacroShape;
    expect(macroPorts(inst).map((p) => p.name)).toEqual(['addr', 'data']);
    expect((again.shapes.ext as WireShape).from?.port).toBe('data');
  });

  it('explode gives back ordinary shapes in place', () => {
    const r = makeCustomMacro(cache(), ['c', 'in', 'out'], 'L1$');
    if (!r.ok) throw new Error(r.error);
    const { doc, ids } = explodeCustom(r.doc, r.instance.id);
    expect(ids).toHaveLength(3);
    const b = ids.map((id) => doc.shapes[id]).find((s) => s.type === 'box')!;
    expect(b).toMatchObject({ x: 100, y: 100, w: 80, h: 60 });
    expect(bindConnections(doc, ['ext']).shapes.ext).not.toHaveProperty('from');
  });
});
