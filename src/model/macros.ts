// Hardware macros. Each kind is described once in a local frame where signals
// flow left to right: u runs along the flow (0..L), v across it (0..T, top to
// bottom). `toWorld` maps that frame onto the macro's box for any direction,
// so ports, outlines and pin labels rotate together while text stays upright.

import type { Direction, MacroKind, MacroShape, Pt, TextAnchor } from './types';

export interface Port {
  name: string;
  p: Pt;
  role: 'in' | 'out' | 'ctrl';
  /** Wires should meet this port with a horizontal (true) or vertical segment. */
  horizontal: boolean;
}

export interface MacroText {
  p: Pt;
  text: string;
  size: number;
  anchor: TextAnchor;
  bold?: boolean;
}

export interface MacroGeometry {
  /** Closed outline, a circle for operator nodes, or none for custom macros (which draw their own shapes). */
  outline: { kind: 'poly'; pts: Pt[] } | { kind: 'circle'; c: Pt; r: number } | { kind: 'none' };
  /** Extra open strokes, e.g. the clock triangle. */
  marks: Pt[][];
  ports: Port[];
  texts: MacroText[];
}

/** Length along the flow (L) and thickness across it (T). */
export const flowSize = (m: Pick<MacroShape, 'w' | 'h' | 'dir'>) =>
  m.dir === 'right' || m.dir === 'left' ? { L: m.w, T: m.h } : { L: m.h, T: m.w };

const mapper = (m: MacroShape) => {
  const { L, T } = flowSize(m);
  const map: Record<Direction, (u: number, v: number) => Pt> = {
    right: (u, v) => ({ x: m.x + u, y: m.y + v }),
    left: (u, v) => ({ x: m.x + L - u, y: m.y + v }),
    // Rotated a quarter turn clockwise: the local top becomes the right side.
    down: (u, v) => ({ x: m.x + T - v, y: m.y + u }),
    up: (u, v) => ({ x: m.x + v, y: m.y + L - u }),
  };
  return { L, T, at: map[m.dir] };
};

/** Pin label placed just inside a port; anchor depends on which side it is on. */
const pinText = (m: MacroShape, at: (u: number, v: number) => Pt, u: number, v: number, text: string, side: 'in' | 'out' | 'top' | 'bottom'): MacroText => {
  const inset = 4;
  const lu = side === 'in' ? u + inset : side === 'out' ? u - inset : u;
  const lv = side === 'top' ? v + inset + 5 : side === 'bottom' ? v - inset : v;
  const p = at(lu, lv);
  const horizontal = m.dir === 'right' || m.dir === 'left';
  let anchor: TextAnchor = 'middle';
  if (horizontal && (side === 'in' || side === 'out')) {
    const towardsRight = (side === 'in') === (m.dir === 'right');
    anchor = towardsRight ? 'start' : 'end';
  }
  return { p: { x: p.x, y: p.y + (side === 'in' || side === 'out' ? 3 : 0) }, text, size: 8, anchor };
};

/** Fraction t of a segment. */
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const muxInset = (L: number, T: number) => Math.min(L * 0.6, Math.max(6, Math.min(12, T * 0.15)));

export const macroGeometry = (m: MacroShape): MacroGeometry => {
  if (m.kind === 'custom') {
    // Custom macros are drawn as defined: no rotation, pins carry their own direction.
    const ports = (m.custom?.ports ?? []).map((p): Port => ({ name: p.name, p: { x: m.x + p.x, y: m.y + p.y }, role: 'in', horizontal: p.horizontal }));
    return { outline: { kind: 'none' }, marks: [], ports, texts: [] };
  }
  const g = rawGeometry(m);
  // Data pins sit on the flow axis; control pins (and the op's 2nd input) across it.
  const flowH = m.dir === 'right' || m.dir === 'left';
  const ports = g.ports.map((p) => ({ ...p, horizontal: p.role === 'ctrl' || (m.kind === 'op' && p.name === 'b') ? !flowH : flowH }));
  return { ...g, ports };
};

type RawPort = Omit<Port, 'horizontal'>;

const rawGeometry = (m: MacroShape): Omit<MacroGeometry, 'ports'> & { ports: RawPort[] } => {
  const { L, T, at } = mapper(m);
  const labelAt = (c: Pt): MacroText[] =>
    m.label
      ? m.label.split('\n').map((line, i, lines) => ({
          p: { x: c.x, y: c.y + m.fontSize * 0.35 + (i - (lines.length - 1) / 2) * m.fontSize * 1.2 },
          text: line,
          size: m.fontSize,
          anchor: 'middle' as const,
          bold: i === 0,
        }))
      : [];
  const label = labelAt(at(L / 2, T / 2));
  const ctrlTop = m.ctrlSide === 'top';

  switch (m.kind) {
    case 'mux': {
      const n = Math.max(2, Math.round(m.inputs));
      const k = Math.min(T * 0.45, m.slant ?? muxInset(L, T));
      const custom = m.inPos?.length === n ? m.inPos : null;
      const local = [{ u: 0, v: 0 }, { u: L, v: k }, { u: L, v: T - k }, { u: 0, v: T }];
      const ports: RawPort[] = [];
      const texts: MacroText[] = [...label];
      for (let i = 0; i < n; i++) {
        const v = custom ? T * custom[i] : (T * (i + 0.5)) / n;
        ports.push({ name: `in${i}`, p: at(0, v), role: 'in' });
        if (m.showIndices) texts.push(pinText(m, at, 0, v, String(i), 'in'));
      }
      ports.push({ name: 'out', p: at(L, T / 2), role: 'out' });
      ports.push({ name: 'sel', p: at(L / 2, ctrlTop ? k / 2 : T - k / 2), role: 'ctrl' });
      return { outline: { kind: 'poly', pts: local.map((q) => at(q.u, q.v)) }, marks: [], ports, texts };
    }
    case 'alu': {
      const k = Math.min(T * 0.45, m.slant ?? T * 0.25);
      const [pa, pb] = m.inPos?.length === 2 ? m.inPos : [0.25, 0.75];
      const local = [
        { u: 0, v: 0 }, { u: L, v: k }, { u: L, v: T - k }, { u: 0, v: T },
        { u: 0, v: T * 0.58 }, { u: L * 0.25, v: T * 0.5 }, { u: 0, v: T * 0.42 },
      ];
      const top = lerp({ x: 0, y: 0 }, { x: L, y: k }, 0.5);
      return {
        outline: { kind: 'poly', pts: local.map((q) => at(q.u, q.v)) },
        marks: [],
        ports: [
          { name: 'a', p: at(0, T * pa), role: 'in' },
          { name: 'b', p: at(0, T * pb), role: 'in' },
          { name: 'out', p: at(L, T / 2), role: 'out' },
          { name: 'op', p: at(top.x, ctrlTop ? top.y : T - top.y), role: 'ctrl' },
        ],
        // Centre the name in the body, clear of the notch.
        texts: labelAt(at(L * 0.6, T / 2)),
      };
    }
    case 'reg': {
      const local = [{ u: 0, v: 0 }, { u: L, v: 0 }, { u: L, v: T }, { u: 0, v: T }];
      const ports: RawPort[] = [
        { name: 'd', p: at(0, T / 2), role: 'in' },
        { name: 'q', p: at(L, T / 2), role: 'out' },
      ];
      const texts: MacroText[] = [...label, pinText(m, at, 0, T / 2, 'D', 'in'), pinText(m, at, L, T / 2, 'Q', 'out')];
      // Clock on the bottom edge with the usual triangle; reset beside it, enable on top.
      const clkU = m.reset ? L / 3 : L / 2;
      const tri = Math.min(6, L / 6, T / 4);
      const marks = [[at(clkU - tri, T), at(clkU, T - tri * 1.3), at(clkU + tri, T)]];
      ports.push({ name: 'clk', p: at(clkU, T), role: 'ctrl' });
      if (m.reset) {
        ports.push({ name: 'rst', p: at((2 * L) / 3, T), role: 'ctrl' });
        texts.push(pinText(m, at, (2 * L) / 3, T, 'rst', 'bottom'));
      }
      if (m.enable) {
        ports.push({ name: 'en', p: at(L / 2, 0), role: 'ctrl' });
        texts.push(pinText(m, at, L / 2, 0, 'en', 'top'));
      }
      return { outline: { kind: 'poly', pts: local.map((q) => at(q.u, q.v)) }, marks, ports, texts };
    }
    case 'op': {
      const r = Math.min(L, T) / 2;
      const c = at(L / 2, T / 2);
      return {
        outline: { kind: 'circle', c, r },
        marks: [],
        ports: [
          { name: 'a', p: at(L / 2 - r, T / 2), role: 'in' },
          { name: 'b', p: at(L / 2, ctrlTop ? T / 2 - r : T / 2 + r), role: 'in' },
          { name: 'out', p: at(L / 2 + r, T / 2), role: 'out' },
        ],
        texts: [{ p: { x: c.x, y: c.y + r * 0.38 }, text: m.symbol, size: Math.max(8, r * 1.1), anchor: 'middle' }],
      };
    }
    case 'custom':
      return { outline: { kind: 'none' }, marks: [], ports: [], texts: [] };
  }
};

export const macroPorts = (m: MacroShape): Port[] => macroGeometry(m).ports;

export const portPosition = (m: MacroShape, name: string): Pt | null => macroPorts(m).find((p) => p.name === name)?.p ?? null;

export interface MacroTemplate {
  kind: Exclude<MacroKind, 'custom'>;
  key: string;
  name: string;
  /** Builds a macro with its top-left corner at the given point. */
  make: (at: Pt, opts: { inputs: number }) => Omit<MacroShape, 'id'>;
}

const base = (kind: MacroKind, at: Pt, w: number, h: number): Omit<MacroShape, 'id'> => ({
  type: 'macro',
  kind,
  x: at.x,
  y: at.y,
  w,
  h,
  dir: 'right',
  fill: '#ffffff',
  stroke: { color: '#000000', width: 1.5, dash: 'solid' },
  label: '',
  fontSize: 11,
  textColor: '#000000',
  inputs: 2,
  ctrlSide: 'top',
  showIndices: false,
  enable: false,
  reset: false,
  symbol: '+',
});

/** Default sizes keep every port on the 10-unit grid. */
export const MACRO_TEMPLATES: MacroTemplate[] = [
  {
    kind: 'mux',
    key: 'm',
    name: 'MUX',
    make: (at, { inputs }) => ({ ...base('mux', at, 20, Math.max(2, inputs) * 20), inputs: Math.max(2, inputs) }),
  },
  { kind: 'alu', key: 'a', name: 'ALU', make: (at) => ({ ...base('alu', at, 60, 120), label: 'ALU', fontSize: 13 }) },
  { kind: 'reg', key: 'r', name: 'Register / FF', make: (at) => ({ ...base('reg', at, 60, 60), label: '' }) },
  { kind: 'op', key: 'o', name: 'Operator (+)', make: (at) => base('op', at, 40, 40) },
];

/** Smallest size that keeps a macro drawable. */
export const minMacroSize = (m: MacroShape): { w: number; h: number } => {
  const across = m.kind === 'mux' ? Math.max(2, m.inputs) * 10 : 20;
  const along = 10;
  return m.dir === 'right' || m.dir === 'left' ? { w: along, h: across } : { w: across, h: along };
};

/**
 * Size steps (along / across the flow) that keep a macro's ports on the
 * 10-unit grid, e.g. a 3-input MUX grows in steps of 60.
 */
export const macroQuantum = (m: MacroShape): { along: number; across: number } => {
  switch (m.kind) {
    case 'mux':
      return { along: 20, across: 20 * Math.max(2, Math.round(m.inputs)) };
    case 'alu':
      return { along: 20, across: 40 };
    case 'reg':
      return { along: m.reset ? 60 : 20, across: 20 };
    case 'op':
    case 'custom':
      return { along: 20, across: 20 };
  }
};

/** Round a stretched macro to its size steps, keeping the edges that did not move. */
export const quantizeMacro = (m: MacroShape, movedLeft: boolean, movedTop: boolean): MacroShape => {
  const q = macroQuantum(m);
  const horizontal = m.dir === 'right' || m.dir === 'left';
  const qw = horizontal ? q.along : q.across, qh = horizontal ? q.across : q.along;
  const w = Math.max(qw, Math.round(m.w / qw) * qw), h = Math.max(qh, Math.round(m.h / qh) * qh);
  return { ...m, w, h, x: movedLeft ? m.x + m.w - w : m.x, y: movedTop ? m.y + m.h - h : m.y };
};
