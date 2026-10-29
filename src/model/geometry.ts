import { FONT_FAMILY } from './presets';
import type { Pt, Shape, TextShape, WireShape } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const snap = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
export const snapPt = (p: Pt, grid: number): Pt => ({ x: snap(p.x, grid), y: snap(p.y, grid) });

export const rectFromPts = (a: Pt, b: Pt): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

export const rectContains = (r: Rect, p: Pt): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const rectInside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

export const unionRects = (rects: Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Text width in user units; falls back to an estimate where canvas is unavailable. */
export const measureText = (text: string, fontSize: number, bold = false): number => {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * fontSize * 0.55;
  measureCtx.font = `${bold ? 'bold ' : ''}${fontSize}px ${FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
};

export const textBounds = (t: TextShape): Rect => {
  const w = Math.max(measureText(t.text, t.fontSize, t.bold), t.fontSize * 0.5);
  const x = t.anchor === 'start' ? t.x : t.anchor === 'middle' ? t.x - w / 2 : t.x - w;
  return { x, y: t.y - t.fontSize * 0.8, w, h: t.fontSize * 1.05 };
};

export const shapeBounds = (s: Shape): Rect => {
  switch (s.type) {
    case 'box':
    case 'macro':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'wire': {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'text':
      return textBounds(s);
    case 'dot':
      return { x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r };
    case 'raw':
      return { x: s.bbox.x + s.dx, y: s.bbox.y + s.dy, w: s.bbox.w, h: s.bbox.h };
  }
};

export const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Is the point on (or within tol of) the shape? */
export const hitShape = (s: Shape, p: Pt, tol: number): boolean => {
  switch (s.type) {
    case 'wire':
      for (let i = 0; i + 1 < s.points.length; i++) {
        if (distToSegment(p, s.points[i], s.points[i + 1]) <= tol) return true;
      }
      return false;
    case 'dot':
      return Math.hypot(p.x - s.x, p.y - s.y) <= s.r + tol;
    default: {
      const r = shapeBounds(s);
      return rectContains({ x: r.x - tol, y: r.y - tol, w: r.w + 2 * tol, h: r.h + 2 * tol }, p);
    }
  }
};

export const isHorizontal = (a: Pt, b: Pt): boolean => a.y === b.y && a.x !== b.x;
export const isVertical = (a: Pt, b: Pt): boolean => a.x === b.x && a.y !== b.y;

/** Drop repeated points and collinear interior vertices. */
export const simplifyPolyline = (pts: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push({ ...p });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const sameDir = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0;
    if (cross === 0 && sameDir) out.splice(i, 1);
  }
  return out;
};

/** Orthogonal route from a to b with one bend. */
export const lRoute = (a: Pt, b: Pt, horizontalFirst: boolean): Pt[] => {
  if (a.x === b.x || a.y === b.y) return [b];
  return horizontalFirst ? [{ x: b.x, y: a.y }, b] : [{ x: a.x, y: b.y }, b];
};

/** Midpoint of the first non-degenerate segment, and its direction. */
export const busMarkPosition = (pts: Pt[]): { p: Pt; horizontal: boolean } | null => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.x === b.x && a.y === b.y) continue;
    return { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) };
  }
  return null;
};

export const polylineLength = (pts: Pt[]): number => {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return len;
};

/** Point at fraction t (0..1) of the polyline's length, with the direction of that segment. */
export const pointAlong = (pts: Pt[], t: number): { p: Pt; horizontal: boolean } => {
  const total = polylineLength(pts);
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    if (left <= len || i + 2 === pts.length) {
      const f = Math.min(1, left / len);
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) };
    }
    left -= len;
  }
  return { p: pts[0] ?? { x: 0, y: 0 }, horizontal: true };
};

/** Fraction along the polyline of the point closest to p. */
export const projectOnto = (pts: Pt[], p: Pt): number => {
  const total = polylineLength(pts);
  if (total === 0) return 0;
  let best = Infinity, bestAt = 0, walked = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const d = Math.hypot(p.x - (a.x + f * dx), p.y - (a.y + f * dy));
    if (d < best) {
      best = d;
      bestAt = walked + f * len;
    }
    walked += len;
  }
  return bestAt / total;
};

export const WIRE_LABEL_SIZE = 10;
export const DEFAULT_LABEL_POS = 0.25;

/** Where a wire's label is drawn: above horizontal runs, right of vertical ones. */
export const wireLabelLayout = (w: WireShape): { x: number; y: number; anchor: 'middle' | 'start'; bounds: Rect } | null => {
  if (!w.label || w.points.length < 2) return null;
  const { p, horizontal } = pointAlong(w.points, w.labelPos ?? DEFAULT_LABEL_POS);
  const fs = WIRE_LABEL_SIZE;
  const width = measureText(w.label, fs);
  if (horizontal) {
    const y = p.y - 4;
    return { x: p.x, y, anchor: 'middle', bounds: { x: p.x - width / 2, y: y - fs * 0.8, w: width, h: fs } };
  }
  const x = p.x + 4, y = p.y + fs * 0.35;
  return { x, y, anchor: 'start', bounds: { x, y: y - fs * 0.8, w: width, h: fs } };
};
