import { describe, expect, it } from 'vitest';
import { AI_EXAMPLE, AI_PROMPT } from '../src/io/aiFormat';
import { importSvg } from '../src/io/importSvg';
import { portPosition } from '../src/model/macros';
import type { MacroShape, WireShape } from '../src/model/types';

describe('AI format', () => {
  const { doc, recognized } = importSvg(AI_EXAMPLE);
  const get = (id: string) => doc.shapes[id];

  it('the prompt embeds the tested example', () => {
    expect(AI_PROMPT).toContain(AI_EXAMPLE);
  });

  it('partial models get defaults and keep their ids', () => {
    expect(get('nextpc')).toMatchObject({ type: 'macro', kind: 'mux', inputs: 3, w: 20, h: 60, showIndices: true, dir: 'right' });
    expect(get('pc')).toMatchObject({ kind: 'reg', label: 'PC', w: 60, h: 60 });
    expect(get('four')).toMatchObject({ type: 'box', text: '4', fill: '#ffffff' });
    // Nothing needed guessing.
    expect(recognized).toBeUndefined();
  });

  it('pin-to-pin wires are routed orthogonally and attached', () => {
    const wires = doc.order.map((id) => doc.shapes[id]).filter((s): s is WireShape => s.type === 'wire');
    expect(wires).toHaveLength(5);
    for (const w of wires) {
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1], b = w.points[i];
        expect(a.x === b.x || a.y === b.y, JSON.stringify(w.points)).toBe(true);
      }
    }
    const toAlu = wires.find((w) => w.to?.id === 'alu')!;
    expect(toAlu.points[0]).toEqual(portPosition(get('nextpc') as MacroShape, 'out'));
    expect(toAlu.points.at(-1)).toEqual(portPosition(get('alu') as MacroShape, 'a'));
    // A wire into the select pin comes in vertically.
    const sel = wires.find((w) => w.to?.port === 'sel')!;
    const [p, q] = sel.points.slice(-2);
    expect(p.x).toBe(q.x);
  });

  it('accepts JSON that is broken or of unknown type by skipping it', () => {
    const r = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"><g data-bdd-json='{"type":"blob"}'/><g data-bdd-json='{oops'/><g data-bdd-json='{"type":"wire","from":{"id":"nope","port":"x"},"to":{"id":"nope","port":"y"}}'/></svg>`);
    expect(r.doc.order).toHaveLength(0);
  });
});

describe('FORMAT.md', () => {
  it('carries the current prompt', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const md = readFileSync(resolve(__dirname, '../FORMAT.md'), 'utf8');
    expect(md).toContain(AI_PROMPT.trim());
  });
});
