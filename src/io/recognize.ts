// Turns the primitives of a foreign SVG back into hardware meaning:
// trapezoids become MUXes, notched trapezoids ALUs, circles with an operator
// symbol operator nodes; wire ends touching their pins get attached; text next
// to a wire becomes that wire's label; dots on T-junctions become automatic.

import { isHorizontal, isVertical, projectOnto, rectContains, textBounds, type Rect } from '../model/geometry';
import { flowSize, macroPorts } from '../model/macros';
import { bindConnections } from '../model/edits';
import { findJunctions } from '../model/junctions';
import { newId, type Direction, type Doc, type MacroShape, type Pt, type RawShape, type Shape, type Stroke, type TextShape, type WireShape } from '../model/types';

const EPS = 0.75;
const PIN_TOL = 3;

const near = (a: number, b: number, tol = EPS) => Math.abs(a - b) <= tol;

const bbox = (pts: Pt[]): Rect => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

const blankMacro = (kind: MacroShape['kind'], r: Rect, dir: Direction, style: MacroStyle): Omit<MacroShape, 'id'> => ({
  type: 'macro',
  kind,
  x: r.x,
  y: r.y,
  w: r.w,
  h: r.h,
  dir,
  fill: style.fill,
  stroke: style.stroke,
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

export interface MacroStyle {
  fill: string;
  stroke: Stroke;
}

/** Which bbox side holds the given points, as the flow direction leaving the opposite side. */
const sideDir = (r: Rect, pts: Pt[]): Direction | null => {
  if (pts.every((p) => near(p.x, r.x))) return 'right';
  if (pts.every((p) => near(p.x, r.x + r.w))) return 'left';
  if (pts.every((p) => near(p.y, r.y))) return 'down';
  if (pts.every((p) => near(p.y, r.y + r.h))) return 'up';
  return null;
};

/** Distance along the output side from the bbox corner to the inset vertex. */
const outputInset = (r: Rect, pts: Pt[], dir: Direction): number => {
  const onOut = pts.filter((p) =>
    dir === 'right' ? near(p.x, r.x + r.w) : dir === 'left' ? near(p.x, r.x) : dir === 'down' ? near(p.y, r.y + r.h) : near(p.y, r.y),
  );
  const across = onOut.map((p) => (dir === 'right' || dir === 'left' ? p.y - r.y : p.x - r.x));
  const T = dir === 'right' || dir === 'left' ? r.h : r.w;
  return across.length === 2 ? (Math.min(...across) + (T - Math.max(...across))) / 2 : NaN;
};

/**
 * MUX: a symmetric trapezoid whose long parallel side is the input side.
 * ALU: the same with a V notch cut into the input side (7 vertices).
 */
export const recognizePolygon = (raw: Pt[], style: MacroStyle): Omit<MacroShape, 'id'> | null => {
  const pts = raw.length > 1 && near(raw[0].x, raw[raw.length - 1].x) && near(raw[0].y, raw[raw.length - 1].y) ? raw.slice(0, -1) : raw;
  const r = bbox(pts);
  if (r.w < 4 || r.h < 4) return null;
  const onBorder = (p: Pt) => near(p.x, r.x) || near(p.x, r.x + r.w) || near(p.y, r.y) || near(p.y, r.y + r.h);

  if (pts.length === 4) {
    // The input side carries two bbox corners.
    const corners = pts.filter((p) => (near(p.x, r.x) || near(p.x, r.x + r.w)) && (near(p.y, r.y) || near(p.y, r.y + r.h)));
    if (corners.length !== 2) return null;
    const dir = sideDir(r, corners);
    if (!dir) return null;
    const inset = outputInset(r, pts, dir);
    const T = dir === 'right' || dir === 'left' ? r.h : r.w;
    if (!(inset > 0.5) || inset > T * 0.45) return null;
    // Both ends inset by about the same amount: a MUX, not an arbitrary wedge.
    const across = pts.filter((p) => !corners.includes(p)).map((p) => (dir === 'right' || dir === 'left' ? p.y - r.y : p.x - r.x));
    if (Math.abs(Math.min(...across) - (T - Math.max(...across))) > Math.max(2, T * 0.15)) return null;
    return { ...blankMacro('mux', r, dir, style), slant: inset };
  }

  if (pts.length === 7) {
    const inner = pts.map((p, i) => ({ p, i })).filter(({ p }) => !onBorder(p));
    if (inner.length !== 1) return null;
    const i = inner[0].i;
    const nb = [pts[(i + 6) % 7], pts[(i + 1) % 7]];
    const dir = sideDir(r, nb);
    if (!dir) return null;
    const inset = outputInset(r, pts, dir);
    const T = dir === 'right' || dir === 'left' ? r.h : r.w;
    if (!(inset > 0.5) || inset > T * 0.45) return null;
    return { ...blankMacro('alu', r, dir, style), label: '', slant: inset };
  }
  return null;
};

/** Operator symbols accepted inside a circle. */
const OP_SYMBOLS: Record<string, string> = { '+': '+', '-': '−', '−': '−', '×': '×', x: '×', '*': '×', '⊕': '⊕', '&': '&', '|': '|', '=': '=' };

export interface CircleCandidate {
  raw: RawShape;
  c: Pt;
  r: number;
  style: MacroStyle;
}

/** Local "across" coordinate (0..T) of a world point, for the macro's direction. */
const acrossOf = (m: MacroShape, p: Pt): number => {
  const { T } = flowSize(m);
  switch (m.dir) {
    case 'right':
    case 'left':
      return p.y - m.y;
    case 'down':
      return m.x + T - p.x;
    case 'up':
      return p.x - m.x;
  }
};

const onInputSide = (m: MacroShape, p: Pt): boolean => {
  const within = (v: number, a: number, b: number) => v > a + EPS && v < b - EPS;
  switch (m.dir) {
    case 'right':
      return near(p.x, m.x, PIN_TOL) && within(p.y, m.y, m.y + m.h);
    case 'left':
      return near(p.x, m.x + m.w, PIN_TOL) && within(p.y, m.y, m.y + m.h);
    case 'down':
      return near(p.y, m.y, PIN_TOL) && within(p.x, m.x, m.x + m.w);
    case 'up':
      return near(p.y, m.y + m.h, PIN_TOL) && within(p.x, m.x, m.x + m.w);
  }
};

const wireEnds = (shapes: Shape[]): { w: WireShape; i: number; p: Pt }[] =>
  shapes.flatMap((s) => (s.type === 'wire' && s.points.length >= 2 ? [{ w: s, i: 0, p: s.points[0] }, { w: s, i: s.points.length - 1, p: s.points[s.points.length - 1] }] : []));

/** Short text just inside a MUX's input side, e.g. the "0" of a constant input. */
const constantPins = (m: MacroShape, texts: TextShape[]): number[] => {
  if (m.kind !== 'mux') return [];
  return texts.flatMap((t) => {
    if (t.text.trim().length > 4) return [];
    const b = textBounds(t);
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (!rectContains({ x: m.x, y: m.y, w: m.w, h: m.h }, c)) return [];
    const depth = m.dir === 'right' ? b.x - m.x : m.dir === 'left' ? m.x + m.w - (b.x + b.w) : m.dir === 'down' ? b.y - m.y : m.y + m.h - (b.y + b.h);
    return depth <= 8 ? [acrossOf(m, c)] : [];
  });
};

/**
 * Recover a MUX / ALU's inputs from the wires entering it (plus constant-input
 * labels) and where they sit; find which side its control pin is on.
 */
const fitPins = (m: MacroShape, ends: { p: Pt }[], texts: TextShape[]): MacroShape => {
  const { T } = flowSize(m);
  const across = ends.filter((e) => onInputSide(m, e.p)).map((e) => acrossOf(m, e.p));
  for (const v of constantPins(m, texts)) if (across.every((a) => Math.abs(a - v) > 6)) across.push(v);
  // The ALU notch is not an input.
  const pins = [...new Set(across.map((v) => Math.round(v * 2) / 2))]
    .filter((v) => m.kind !== 'alu' || v < T * 0.4 || v > T * 0.6)
    .sort((a, b) => a - b);
  let next: MacroShape = m;
  if (m.kind === 'mux' && pins.length >= 2) next = { ...m, inputs: pins.length, inPos: pins.map((v) => v / T) };
  if (m.kind === 'alu' && pins.length === 2) next = { ...m, inPos: pins.map((v) => v / T) };
  // Control pin: a wire end on the slanted side nearest the middle of the flow.
  const ctrl = macroPorts({ ...next, ctrlSide: 'bottom' }).find((p) => p.role === 'ctrl');
  if (ctrl && ends.some((e) => Math.hypot(e.p.x - ctrl.p.x, e.p.y - ctrl.p.y) <= PIN_TOL)) next = { ...next, ctrlSide: 'bottom' };
  return next;
};

const textInside = (t: TextShape, r: Rect) => {
  const b = textBounds(t);
  return rectContains(r, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
};

/** Caption just above or below a macro, centred on it. */
const isCaption = (t: TextShape, m: MacroShape) => {
  const b = textBounds(t);
  const cx = b.x + b.w / 2;
  const centred = Math.abs(cx - (m.x + m.w / 2)) <= Math.max(6, m.w * 0.5);
  const above = b.y + b.h >= m.y - 10 && b.y + b.h <= m.y + 2;
  const below = b.y >= m.y + m.h - 2 && b.y <= m.y + m.h + 10;
  return centred && (above || below);
};

const sameColor = (a: string, b: string) => normColor(a) === normColor(b);
const normColor = (c: string) => {
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((ch) => ch + ch).join('');
  return s === 'black' ? '#000000' : s;
};

/**
 * Text set just above a horizontal run or just right of a vertical run of a
 * wire of the same colour becomes that wire's label.
 */
const attachWireLabels = (shapes: Shape[]): { shapes: Shape[]; count: number } => {
  const wires = shapes.filter((s): s is WireShape => s.type === 'wire');
  const consumed = new Set<string>();
  const labelled = new Map<string, WireShape>();
  for (const t of shapes) {
    if (t.type !== 'text' || !t.text.trim() || t.anchor === 'end') continue;
    const b = textBounds(t);
    let best: { w: WireShape; d: number; at: Pt } | null = null;
    for (const w of wires) {
      if (labelled.has(w.id) || w.label || !sameColor(w.stroke.color, t.color)) continue;
      for (let i = 0; i + 1 < w.points.length; i++) {
        const a = w.points[i], c = w.points[i + 1];
        if (isHorizontal(a, c)) {
          const gap = a.y - t.y; // baseline above the line
          const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
          if (gap >= 1 && gap <= 9 && b.x >= x0 - 2 && b.x + b.w <= x1 + 2 && (!best || gap < best.d)) {
            best = { w, d: gap, at: { x: b.x + b.w / 2, y: a.y } };
          }
        } else if (isVertical(a, c) && t.anchor === 'start') {
          const gap = t.x - a.x;
          const y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
          if (gap >= 1 && gap <= 9 && t.y >= y0 && t.y <= y1 && (!best || gap < best.d)) best = { w, d: gap, at: { x: a.x, y: t.y } };
        }
      }
    }
    if (!best) continue;
    labelled.set(best.w.id, { ...best.w, label: t.text, labelPos: Math.round(projectOnto(best.w.points, best.at) * 1000) / 1000 });
    consumed.add(t.id);
  }
  return { shapes: shapes.filter((s) => !consumed.has(s.id)).map((s) => labelled.get(s.id) ?? s), count: labelled.size };
};

export interface RecognizeStats {
  mux: number;
  alu: number;
  op: number;
  labels: number;
  attached: number;
}

export const recognize = (input: Shape[], circles: CircleCandidate[]): { shapes: Shape[]; stats: RecognizeStats } => {
  let shapes = [...input];
  const stats: RecognizeStats = { mux: 0, alu: 0, op: 0, labels: 0, attached: 0 };
  const consumed = new Set<string>();

  // Circles holding a single operator symbol become operator nodes.
  for (const c of circles) {
    const sym = shapes.find(
      (t): t is TextShape => t.type === 'text' && !consumed.has(t.id) && OP_SYMBOLS[t.text.trim()] !== undefined && Math.hypot(textBounds(t).x + textBounds(t).w / 2 - c.c.x, t.y - t.fontSize * 0.35 - c.c.y) <= c.r * 0.6,
    );
    if (!sym) continue;
    const op: MacroShape = {
      ...blankMacro('op', { x: c.c.x - c.r, y: c.c.y - c.r, w: 2 * c.r, h: 2 * c.r }, 'right', c.style),
      id: c.raw.id,
      symbol: OP_SYMBOLS[sym.text.trim()],
    };
    shapes = shapes.map((s) => (s.id === c.raw.id ? op : s));
    consumed.add(sym.id);
    stats.op++;
  }

  // Pins from the wires that touch each MUX / ALU; text inside an ALU is its name.
  const ends = wireEnds(shapes);
  const texts = shapes.filter((t): t is TextShape => t.type === 'text');
  shapes = shapes.map((s) => (s.type === 'macro' && (s.kind === 'mux' || s.kind === 'alu') ? fitPins(s, ends, texts) : s));
  for (const m of shapes) {
    if (m.type !== 'macro') continue;
    if (m.kind === 'mux') stats.mux++;
    if (m.kind === 'alu') stats.alu++;
    const r = { x: m.x, y: m.y, w: m.w, h: m.h };
    const inside = shapes.filter((t): t is TextShape => t.type === 'text' && !consumed.has(t.id) && textInside(t, r));
    if (m.kind === 'alu' && inside.length) {
      inside.sort((a, b) => a.y - b.y);
      Object.assign(m, { label: inside.map((t) => t.text).join('\n'), fontSize: inside[0].fontSize, textColor: inside[0].color });
      inside.forEach((t) => consumed.add(t.id));
    } else if (m.kind === 'mux') {
      // Pin numbers inside and a caption above / below travel with the MUX as a group.
      const captions = shapes.filter((t): t is TextShape => t.type === 'text' && !consumed.has(t.id) && isCaption(t, m));
      const members = [...inside, ...captions];
      if (members.length) {
        const g = newId('g');
        m.groupId = g;
        for (const t of members) t.groupId = g;
      }
    }
  }
  shapes = shapes.filter((s) => !consumed.has(s.id));

  const labelled = attachWireLabels(shapes);
  shapes = labelled.shapes;
  stats.labels = labelled.count;

  // Snap wire ends onto pins they almost touch, then record the attachments.
  const macros = shapes.filter((s): s is MacroShape => s.type === 'macro');
  const pins = macros.flatMap((m) => macroPorts(m).map((p) => p.p));
  shapes = shapes.map((s) => {
    if (s.type !== 'wire' || s.points.length < 2) return s;
    const pts = s.points.map((p, i) => {
      if (i !== 0 && i !== s.points.length - 1) return p;
      const pin = pins.find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= PIN_TOL);
      return pin ?? p;
    });
    return { ...s, points: pts };
  });
  let doc: Doc = { shapes: Object.fromEntries(shapes.map((s) => [s.id, s])), order: shapes.map((s) => s.id) };
  doc = bindConnections(doc, doc.order.filter((id) => doc.shapes[id].type === 'wire'));
  for (const id of doc.order) {
    const w = doc.shapes[id];
    if (w.type === 'wire') stats.attached += (w.from ? 1 : 0) + (w.to ? 1 : 0);
  }

  // Dots the app would draw by itself anyway are dropped, so they track later edits.
  const withoutDots: Doc = { shapes: doc.shapes, order: doc.order.filter((id) => doc.shapes[id].type !== 'dot') };
  const auto = findJunctions(withoutDots);
  const redundant = new Set(
    doc.order.filter((id) => {
      const d = doc.shapes[id];
      return d.type === 'dot' && auto.some((j) => Math.hypot(j.p.x - d.x, j.p.y - d.y) <= d.r);
    }),
  );
  return { shapes: doc.order.filter((id) => !redundant.has(id)).map((id) => doc.shapes[id]), stats };
};
