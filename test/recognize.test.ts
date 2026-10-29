import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importSvg } from '../src/io/importSvg';
import { macroPorts, portPosition } from '../src/model/macros';
import type { MacroShape, Shape, WireShape } from '../src/model/types';

const shapesOf = (svg: string) => {
  const { doc, recognized } = importSvg(svg);
  return { all: doc.order.map((id) => doc.shapes[id]), recognized };
};
const macros = (all: Shape[]) => all.filter((s): s is MacroShape => s.type === 'macro');
const wires = (all: Shape[]) => all.filter((s): s is WireShape => s.type === 'wire');
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${body}</svg>`;

describe('recognising hardware symbols in foreign SVG', () => {
  it('a trapezoid with three wires in becomes a 3-input MUX with those pin positions', () => {
    const { all } = shapesOf(
      svg(`<path d="M100,100 L120,108 L120,192 L100,200 Z" fill="#fff" stroke="#000"/>
        <polyline points="40,120 100,120" fill="none" stroke="#000"/>
        <polyline points="40,150 100,150" fill="none" stroke="#000"/>
        <polyline points="40,190 100,190" fill="none" stroke="#000"/>
        <polyline points="120,150 200,150" fill="none" stroke="#000"/>
        <polyline points="110,40 110,104" fill="none" stroke="#000"/>`),
    );
    const [m] = macros(all);
    expect(m).toMatchObject({ kind: 'mux', dir: 'right', x: 100, y: 100, w: 20, h: 100, inputs: 3, slant: 8, ctrlSide: 'top' });
    // Pins land exactly where the drawing had them, and the wires are attached.
    expect(macroPorts(m).filter((p) => p.role === 'in').map((p) => p.p.y)).toEqual([120, 150, 190]);
    const attached = wires(all).flatMap((w) => [w.from?.port, w.to?.port]).filter(Boolean).sort();
    expect(attached).toEqual(['in0', 'in1', 'in2', 'out', 'sel']);
  });

  it('detects flow direction, e.g. a MUX pointing down drawn as <polygon>', () => {
    const { all } = shapesOf(svg(`<polygon points="100,100 200,100 190,120 110,120" fill="#fff" stroke="#000"/>`));
    expect(macros(all)[0]).toMatchObject({ kind: 'mux', dir: 'down', w: 100, h: 20 });
  });

  it('an asymmetric wedge is not mistaken for a MUX', () => {
    const { all } = shapesOf(svg(`<path d="M0,0 L20,2 L20,60 L0,100 Z" fill="#fff" stroke="#000"/>`));
    expect(macros(all)).toHaveLength(0);
    expect(all[0].type).toBe('raw');
  });

  it('a notched trapezoid becomes an ALU and takes the text inside as its name', () => {
    const { all } = shapesOf(
      svg(`<path d="M60,40 L130,90 L130,200 L60,250 L60,165 L78,145 L60,125 Z" fill="#fff" stroke="#000"/>
        <text x="102" y="150" font-size="13" text-anchor="middle" font-weight="bold">ALU</text>`),
    );
    expect(all.filter((s) => s.type === 'text')).toHaveLength(0);
    expect(macros(all)[0]).toMatchObject({ kind: 'alu', dir: 'right', label: 'ALU', slant: 50 });
  });

  it('a circle with an operator symbol becomes an operator node', () => {
    const { all } = shapesOf(svg(`<circle cx="50" cy="50" r="15" fill="#fff" stroke="#000"/><text x="50" y="55" font-size="16" text-anchor="middle">+</text>`));
    expect(macros(all)[0]).toMatchObject({ kind: 'op', symbol: '+', x: 35, y: 35, w: 30, h: 30 });
    expect(all).toHaveLength(1);
  });

  it('sees through translate() groups', () => {
    const { all } = shapesOf(
      svg(`<g transform="translate(100, 50)"><g transform="translate(10)">
        <path d="M0,0 L20,8 L20,52 L0,60 Z" fill="#fff" stroke="#000"/>
        <polyline points="-40,15 0,15" fill="none" stroke="#000"/>
      </g></g>
      <g transform="rotate(45)"><rect x="0" y="0" width="10" height="10"/></g>`),
    );
    const [m] = macros(all);
    expect(m).toMatchObject({ kind: 'mux', x: 110, y: 50, h: 60 });
    expect(wires(all)[0].points).toEqual([{ x: 70, y: 65 }, { x: 110, y: 65 }]);
    expect(wires(all)[0].to?.port).toBe('in0');
    // Rotations stay verbatim.
    expect(all.filter((s) => s.type === 'raw')).toHaveLength(1);
  });

  it('text riding on a wire becomes its label', () => {
    const { all } = shapesOf(
      svg(`<polyline points="0,100 200,100" fill="none" stroke="#000"/><text x="20" y="94" font-size="10">rs1 data</text>
           <polyline points="300,0 300,200" fill="none" stroke="#b03030"/><text x="306" y="80" font-size="9" fill="#b03030">exc</text>
           <text x="20" y="160" font-size="10">far away</text>`),
    );
    const [h, v] = wires(all);
    expect(h.label).toBe('rs1 data');
    expect(v.label).toBe('exc');
    expect(all.filter((s) => s.type === 'text').map((t) => (t as { text: string }).text)).toEqual(['far away']);
  });
});

describe('the RV32 pipeline drawing', () => {
  const { all, recognized } = shapesOf(readFileSync(resolve(__dirname, 'fixtures/rv32_pipeline.svg'), 'utf8'));
  const ms = macros(all);

  it('finds every MUX and the ALU', () => {
    expect(recognized).toMatchObject({ mux: 11, alu: 1 });
  });

  it('counts inputs from wires and constant labels, not powers of two', () => {
    const byPos = (x: number, y: number) => ms.find((m) => m.x === x && m.y === y)!;
    expect(byPos(2230, 230).inputs).toBe(6); // WB mux
    expect(byPos(1925, 595).inputs).toBe(3); // mem_out
    expect(byPos(1000, 535).inputs).toBe(3); // Op-A: two wires + constant 0
    expect(byPos(1000, 655).inputs).toBe(4); // Op-B: two wires + constants 4, 0
  });

  it('keeps every wire end where it was drawn, now attached to the pins', () => {
    const wb = ms.find((m) => m.x === 2230)!;
    expect(portPosition(wb, 'in5')).toEqual({ x: 2230, y: 978 });
    expect(portPosition(wb, 'out')).toEqual({ x: 2250, y: 620 });
    const into = wires(all).filter((w) => w.to?.id === wb.id).map((w) => w.to!.port).sort();
    expect(into).toEqual(['in0', 'in1', 'in2', 'in3', 'in4', 'in5', 'sel']);
  });

  it('turns signal names into wire labels', () => {
    const labels = wires(all).map((w) => w.label).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(['rs1 data', 'imm', 'alu_out / address', 'exc', 'imem_wait']));
    expect(recognized!.labels).toBeGreaterThan(30);
  });

  it('groups a MUX with its caption', () => {
    const fwdA = ms.find((m) => m.x === 900 && m.y === 505)!;
    const caption = all.find((s) => s.type === 'text' && s.text === 'Fwd-A')!;
    expect(fwdA.groupId).toBeDefined();
    expect(caption.groupId).toBe(fwdA.groupId);
  });
});
