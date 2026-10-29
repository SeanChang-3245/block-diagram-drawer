// SVG import. Files saved by this app carry their model in data-bdd-json and
// reopen exactly. Any other SVG (e.g. one drawn by an AI) is converted
// heuristically: rect -> box, line/polyline/open path -> wire, small circle ->
// junction dot, text -> label (merged into the box it is centred in).
// Everything else is kept verbatim as a movable raw element.

import { defaultBox, defaultText, defaultWire } from '../model/presets';
import { textBounds } from '../model/geometry';
import { newId, type BoxShape, type Dash, type Doc, type Pt, type RawShape, type Shape, type TextShape, type WireShape } from '../model/types';

const INHERITED = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-weight', 'text-anchor']);

const styleProp = (el: Element, name: string): string | null => {
  const style = el.getAttribute('style');
  if (style) {
    for (const decl of style.split(';')) {
      const [k, ...v] = decl.split(':');
      if (k?.trim() === name) return v.join(':').trim();
    }
  }
  return el.getAttribute(name);
};

/** Presentation attribute, honouring style="" and inheritance from ancestors. */
const attr = (el: Element, name: string): string | null => {
  let cur: Element | null = el;
  while (cur) {
    const v = styleProp(cur, name);
    if (v !== null && v !== 'inherit') return v;
    if (!INHERITED.has(name)) return null;
    cur = cur.parentElement;
  }
  return null;
};

const num = (v: string | null, fallback = 0): number => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};

const color = (v: string | null, fallback: string): string => {
  if (v === null || v === '') return fallback;
  return v === 'transparent' ? 'none' : v;
};

const dashOf = (el: Element): Dash => {
  const d = attr(el, 'stroke-dasharray');
  if (!d || d === 'none') return 'solid';
  return num(d.split(/[\s,]+/)[0]) <= 2 ? 'dotted' : 'dashed';
};

const hasMarker = (el: Element, which: 'marker-start' | 'marker-end'): boolean => {
  const v = styleProp(el, which);
  return !!v && v !== 'none';
};

const parsePoints = (s: string): Pt[] => {
  const n = s.trim().split(/[\s,]+/).map(Number);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
  return pts;
};

/** Points of a path made only of M/L/H/V commands, or null if it is anything else. */
const parseOpenPath = (d: string): Pt[] | null => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g);
  if (!tokens) return null;
  const pts: Pt[] = [];
  let cmd = '';
  let cur: Pt = { x: 0, y: 0 };
  let i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M':
        if (pts.length) return null; // multiple subpaths
        cur = rel ? { x: cur.x + next(), y: cur.y + next() } : { x: next(), y: next() };
        pts.push(cur);
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        cur = rel ? { x: cur.x + next(), y: cur.y + next() } : { x: next(), y: next() };
        pts.push(cur);
        break;
      case 'H': {
        const x = next();
        cur = { x: rel ? cur.x + x : x, y: cur.y };
        pts.push(cur);
        break;
      }
      case 'V': {
        const y = next();
        cur = { x: cur.x, y: rel ? cur.y + y : y };
        pts.push(cur);
        break;
      }
      default:
        return null; // curves, arcs or Z: not a wire
    }
  }
  return pts.length >= 2 && pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : null;
};

/** Strip anything executable from markup we keep verbatim. */
const sanitize = (el: Element): void => {
  for (const bad of Array.from(el.querySelectorAll('script, foreignObject'))) bad.remove();
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    for (const a of Array.from(node.attributes)) {
      if (/^on/i.test(a.name) || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) node.removeAttribute(a.name);
    }
  }
};

const rawBBox = (markup: string, el: Element): RawShape['bbox'] => {
  // Real geometry when a layout engine is available.
  if (typeof document !== 'undefined' && document.body) {
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    host.setAttribute('style', 'position:absolute;left:-9999px;top:-9999px;visibility:hidden');
    host.innerHTML = markup;
    document.body.appendChild(host);
    try {
      const g = host.firstElementChild as SVGGraphicsElement | null;
      if (g && typeof g.getBBox === 'function') {
        const b = g.getBBox();
        if (b.width || b.height) return { x: b.x, y: b.y, w: b.width, h: b.height };
      }
    } catch {
      // fall through to the estimate
    } finally {
      host.remove();
    }
  }
  // Estimate from the coordinates mentioned in the element.
  const src = [el.getAttribute('d'), el.getAttribute('points'), ...['x', 'y', 'cx', 'cy'].map((a) => el.getAttribute(a))].join(' ');
  const n = (src.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (n.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

interface ImportCtx {
  shapes: Shape[];
  serializer: XMLSerializer;
  viewBox: { x: number; y: number; w: number; h: number };
}

const keepRaw = (el: Element, ctx: ImportCtx) => {
  const clone = el.cloneNode(true) as Element;
  sanitize(clone);
  // Bake inherited presentation attributes so the element looks the same out of context.
  for (const name of INHERITED) {
    if (!clone.getAttribute(name) && !styleProp(clone, name)) {
      const v = attr(el, name);
      if (v !== null) clone.setAttribute(name, v);
    }
  }
  const markup = ctx.serializer.serializeToString(clone).replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
  ctx.shapes.push({ id: newId(), type: 'raw', markup, dx: 0, dy: 0, bbox: rawBBox(markup, el) });
};

const strokeOf = (el: Element, fallbackColor: string) => ({
  color: color(attr(el, 'stroke'), fallbackColor),
  width: num(attr(el, 'stroke-width'), 1),
  dash: dashOf(el),
});

const wireFrom = (el: Element, points: Pt[]): WireShape => ({
  ...defaultWire(),
  id: newId(),
  points,
  stroke: strokeOf(el, 'none'),
  arrowStart: hasMarker(el, 'marker-start'),
  arrowEnd: hasMarker(el, 'marker-end'),
});

const walk = (el: Element, ctx: ImportCtx): void => {
  const tag = el.localName;
  if (['defs', 'title', 'desc', 'metadata', 'style', 'script', 'marker', 'clipPath', 'mask', 'symbol'].includes(tag)) return;

  const model = el.getAttribute('data-bdd-json');
  if (model) {
    try {
      const s = JSON.parse(model) as Shape;
      ctx.shapes.push({ ...s, id: s.id || newId() });
      return;
    } catch {
      // malformed model: fall back to the visible markup below
    }
  }
  if (el.hasAttribute('data-bdd-bg') || el.hasAttribute('data-bdd-derived')) return;
  if (el.hasAttribute('transform') && tag !== 'svg') return keepRaw(el, ctx);

  switch (tag) {
    case 'svg':
    case 'g':
    case 'a':
      for (const child of Array.from(el.children)) walk(child, ctx);
      return;
    case 'rect': {
      const x = num(el.getAttribute('x')), y = num(el.getAttribute('y'));
      const w = num(el.getAttribute('width')), h = num(el.getAttribute('height'));
      const stroke = color(attr(el, 'stroke'), 'none');
      const vb = ctx.viewBox;
      const isBackground = stroke === 'none' && x <= vb.x && y <= vb.y && w >= vb.w * 0.98 && h >= vb.h * 0.98;
      if (isBackground) return;
      ctx.shapes.push({
        ...defaultBox(),
        id: newId(),
        x, y, w, h,
        fill: color(attr(el, 'fill'), '#000000'),
        stroke: { ...strokeOf(el, 'none'), color: stroke },
        radius: num(el.getAttribute('rx')),
      });
      return;
    }
    case 'line': {
      const p = (a: string) => num(el.getAttribute(a));
      ctx.shapes.push(wireFrom(el, [{ x: p('x1'), y: p('y1') }, { x: p('x2'), y: p('y2') }]));
      return;
    }
    case 'polyline': {
      const pts = parsePoints(el.getAttribute('points') ?? '');
      if (pts.length >= 2) ctx.shapes.push(wireFrom(el, pts));
      return;
    }
    case 'path': {
      const fill = color(attr(el, 'fill'), '#000000');
      const pts = parseOpenPath(el.getAttribute('d') ?? '');
      if (pts && fill === 'none') ctx.shapes.push(wireFrom(el, pts));
      else keepRaw(el, ctx);
      return;
    }
    case 'circle': {
      const r = num(el.getAttribute('r'));
      const fill = color(attr(el, 'fill'), '#000000');
      if (r > 0 && r <= 4 && fill !== 'none') {
        ctx.shapes.push({ id: newId(), type: 'dot', x: num(el.getAttribute('cx')), y: num(el.getAttribute('cy')), r, color: fill });
      } else keepRaw(el, ctx);
      return;
    }
    case 'text': {
      const content = el.textContent ?? '';
      const anchor = attr(el, 'text-anchor');
      const weight = attr(el, 'font-weight');
      ctx.shapes.push({
        ...defaultText(),
        id: newId(),
        x: num(el.getAttribute('x')),
        y: num(el.getAttribute('y')),
        text: content,
        fontSize: num(attr(el, 'font-size'), 16),
        color: color(attr(el, 'fill'), '#000000'),
        anchor: anchor === 'middle' || anchor === 'end' ? anchor : 'start',
        bold: weight === 'bold' || num(weight) >= 600,
      });
      return;
    }
    default:
      keepRaw(el, ctx);
  }
};

/**
 * Centred text lines that sit inside a box become that box's label, so the
 * text moves and re-centres with the box.
 */
const mergeTextIntoBoxes = (shapes: Shape[]): Shape[] => {
  const boxes = shapes.filter((s): s is BoxShape => s.type === 'box');
  const owned = new Map<string, TextShape[]>();
  const consumed = new Set<string>();
  for (const t of shapes) {
    if (t.type !== 'text' || t.anchor !== 'middle') continue;
    const tb = textBounds(t);
    const cy = tb.y + tb.h / 2;
    let best: BoxShape | null = null;
    for (const b of boxes) {
      const inside = t.x > b.x && t.x < b.x + b.w && cy > b.y && cy < b.y + b.h;
      const centred = Math.abs(t.x - (b.x + b.w / 2)) <= Math.max(2, b.w * 0.1);
      if (inside && centred && (!best || b.w * b.h < best.w * best.h)) best = b;
    }
    if (!best) continue;
    owned.set(best.id, [...(owned.get(best.id) ?? []), t]);
    consumed.add(t.id);
  }
  return shapes
    .filter((s) => !consumed.has(s.id))
    .map((s) => {
      const texts = owned.get(s.id);
      if (s.type !== 'box' || !texts) return s;
      texts.sort((a, b) => a.y - b.y);
      const first = texts[0];
      return {
        ...s,
        text: texts.map((t) => t.text).join('\n'),
        fontSize: first.fontSize,
        textColor: first.color,
        boldFirstLine: first.bold,
      };
    });
};

export interface ImportResult {
  doc: Doc;
  /** True when the file was saved by this app (exact round trip). */
  native: boolean;
  stats: Partial<Record<Shape['type'], number>>;
}

export const importSvg = (source: string): ImportResult => {
  const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = xml.documentElement;
  if (!root || root.localName !== 'svg' || xml.getElementsByTagName('parsererror').length) {
    throw new Error('Not a valid SVG file');
  }
  const native = root.hasAttribute('data-bdd-version');
  const vbAttr = root.getAttribute('viewBox');
  const vbNums = vbAttr?.split(/[\s,]+/).map(Number);
  const viewBox =
    vbNums && vbNums.length === 4
      ? { x: vbNums[0], y: vbNums[1], w: vbNums[2], h: vbNums[3] }
      : { x: 0, y: 0, w: num(root.getAttribute('width'), 0), h: num(root.getAttribute('height'), 0) };

  const ctx: ImportCtx = { shapes: [], serializer: new XMLSerializer(), viewBox };
  walk(root, ctx);
  const shapes = native ? ctx.shapes : mergeTextIntoBoxes(ctx.shapes);

  const doc: Doc = { shapes: {}, order: [] };
  const stats: ImportResult['stats'] = {};
  for (const s of shapes) {
    if (doc.shapes[s.id]) s.id = newId();
    doc.shapes[s.id] = s;
    doc.order.push(s.id);
    stats[s.type] = (stats[s.type] ?? 0) + 1;
  }
  return { doc, native, stats };
};
