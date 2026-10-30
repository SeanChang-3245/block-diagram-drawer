import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoLayout } from '../src/model/layout';
import { importSvg } from '../src/io/importSvg';
import { AI_EXAMPLE } from '../src/io/aiFormat';
import { shapeBounds } from '../src/model/geometry';
import { portPosition } from '../src/model/macros';
import type { Doc, MacroShape, Pt, WireShape } from '../src/model/types';

const orth = (pts: Pt[]) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
const overlaps = (doc: Doc) => {
  const blocks = doc.order.map((id) => doc.shapes[id]).filter((s) => s.type === 'box' || s.type === 'macro');
  let n = 0;
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++) {
      const a = shapeBounds(blocks[i]), b = shapeBounds(blocks[j]);
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
    }
  return n;
};

describe('auto layout', () => {
  it('lays out the AI example left to right with attached orthogonal wires', async () => {
    const doc = importSvg(AI_EXAMPLE).doc;
    // Scramble the blocks first.
    const scrambled: Doc = { ...doc, shapes: { ...doc.shapes } };
    for (const id of doc.order) {
      const s = doc.shapes[id];
      if (s.type === 'macro' || s.type === 'box') scrambled.shapes[id] = { ...s, x: 0, y: 0 };
    }
    const out = await autoLayout(scrambled, null);
    expect(overlaps(out)).toBe(0);
    const x = (id: string) => (out.shapes[id] as MacroShape).x;
    expect(x('pc')).toBeLessThan(x('inc'));
    expect(x('inc')).toBeLessThan(x('nextpc'));
    expect(x('nextpc')).toBeLessThan(x('alu'));
    for (const id of out.order) {
      const w = out.shapes[id];
      if (w.type !== 'wire') continue;
      expect(orth(w.points), JSON.stringify(w.points)).toBe(true);
    }
    const toAlu = out.order.map((id) => out.shapes[id]).find((s): s is WireShape => s.type === 'wire' && s.to?.id === 'alu')!;
    expect(toAlu.points.at(-1)).toEqual(portPosition(out.shapes.alu as MacroShape, 'a'));
    expect(toAlu.points[0]).toEqual(portPosition(out.shapes.nextpc as MacroShape, 'out'));
  });

  it('keeps locked blocks in place', async () => {
    const doc = importSvg(AI_EXAMPLE).doc;
    const locked: Doc = { ...doc, shapes: { ...doc.shapes, alu: { ...doc.shapes.alu, locked: true, x: 900, y: 900 } as MacroShape } };
    const out = await autoLayout(locked, null);
    expect(out.shapes.alu).toMatchObject({ x: 900, y: 900 });
  });

  it('handles the RV32 drawing with stage columns', async () => {
    const doc = importSvg(readFileSync(resolve(__dirname, 'fixtures/rv32_pipeline.svg'), 'utf8')).doc;
    const t0 = Date.now();
    const out = await autoLayout(doc, null, { direction: 'RIGHT', spacing: 40, stages: true });
    console.log('layout ms', Date.now() - t0, 'overlaps', overlaps(out));
    // Pipeline registers keep their left-to-right order.
    const regs = out.order.map((id) => out.shapes[id]).filter((s) => s.type === 'box' && s.h >= 4 * s.w && s.w <= 40) as { x: number }[];
    const before = doc.order.map((id) => doc.shapes[id]).filter((s) => s.type === 'box' && s.h >= 4 * s.w && s.w <= 40) as { x: number; id: string }[];
    const order = (list: { x: number; id?: string }[]) => [...list].sort((a, b) => a.x - b.x).map((r) => (r as { id: string }).id);
    expect(order(regs as never)).toEqual(order(before));
    expect(overlaps(out)).toBe(0);
  }, 30000);
});

describe('AI diagrams without coordinates', () => {
  it('are reported as unplaced and laid out on load', async () => {
    const noCoords = AI_EXAMPLE.replace(/"x":\d+,"y":\d+,?/g, '');
    const r = importSvg(noCoords);
    expect(r.unplaced.sort()).toEqual(['alu', 'four', 'inc', 'nextpc', 'pc']);
    const out = await autoLayout(r.doc, r.unplaced);
    expect(overlaps(out)).toBe(0);
    expect((out.shapes.pc as MacroShape).x).toBeLessThan((out.shapes.alu as MacroShape).x);
  });
});
