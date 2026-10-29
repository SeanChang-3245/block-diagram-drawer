import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportSvg } from '../src/io/exportSvg';
import { importSvg } from '../src/io/importSvg';
import type { BoxShape, TextShape, WireShape } from '../src/model/types';

const fixture = readFileSync(resolve(__dirname, 'fixtures/rv32_pipeline.svg'), 'utf8');

describe('import of a foreign (AI-drawn) SVG', () => {
  const { doc, native, stats } = importSvg(fixture);
  const all = doc.order.map((id) => doc.shapes[id]);
  const boxes = all.filter((s): s is BoxShape => s.type === 'box');
  const wires = all.filter((s): s is WireShape => s.type === 'wire');

  it('recognises boxes, wires, junction dots and keeps the rest', () => {
    expect(native).toBe(false);
    expect(stats.wire).toBeGreaterThan(100);
    expect(stats.dot).toBeGreaterThan(30);
    expect(stats.raw).toBeGreaterThan(10); // mux / ALU paths
    // The full-canvas white background is dropped.
    expect(boxes.some((b) => b.w === 2400 && b.h === 1380)).toBe(false);
  });

  it('merges centred multi-line text into its box', () => {
    const rf = boxes.find((b) => b.text.startsWith('Register File'))!;
    expect(rf).toBeDefined();
    expect(rf.text.split('\n')).toEqual(['Register File', '31 × 32, 2R1W', 'async read,', 'sync write,', 'write-through']);
    expect(rf.boldFirstLine).toBe(true);
    // Left-aligned annotations stay free text.
    expect(all.some((s) => s.type === 'text' && (s as TextShape).text === 'rs1 data')).toBe(true);
  });

  it('maps line styles and arrows', () => {
    const control = wires.find((w) => w.stroke.color === '#555' && w.stroke.dash === 'dashed');
    expect(control?.arrowEnd).toBe(true);
    const exc = wires.find((w) => w.stroke.color === '#b03030');
    expect(exc?.stroke.dash).toBe('dashed');
    const stop = boxes.find((b) => b.text.startsWith('Stop / Fatal'))!;
    expect(stop.stroke.dash).toBe('dashed');
  });
});

describe('native round trip', () => {
  it('save then open reproduces the model exactly', () => {
    const first = importSvg(fixture).doc;
    const saved = exportSvg(first);
    const again = importSvg(saved);
    expect(again.native).toBe(true);
    expect(again.doc.order.map((id) => again.doc.shapes[id])).toEqual(first.order.map((id) => first.shapes[id]));
  });

  it('exports visible markup a plain SVG viewer understands', () => {
    const svg = exportSvg(importSvg(fixture).doc);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('<marker');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('Register File');
  });
});
