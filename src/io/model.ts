// Shapes written by hand or by an AI in the documented format (FORMAT.md):
// only the fields that matter need to be given; everything else gets the
// editor's defaults. Wires may name the pins they connect and leave the
// routing to us.

import { defaultBox, defaultText, defaultWire } from '../model/presets';
import { MACRO_TEMPLATES, macroPorts } from '../model/macros';
import { snap } from '../model/geometry';
import { syncConnections } from '../model/edits';
import { newId, type Doc, type MacroShape, type Pt, type Shape, type Stroke, type WireShape } from '../model/types';

type Loose = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pick = <T,>(v: unknown, ok: (x: unknown) => boolean, fallback: T): T => (ok(v) ? (v as T) : fallback);
const isStr = (v: unknown) => typeof v === 'string';
const isBool = (v: unknown) => typeof v === 'boolean';

const strokeOf = (v: unknown, fallback: Stroke): Stroke => {
  const s = (v && typeof v === 'object' ? v : {}) as Loose;
  return {
    color: pick(s.color, isStr, fallback.color),
    width: pick(s.width, isNum, fallback.width),
    dash: pick(s.dash, (d) => d === 'solid' || d === 'dashed' || d === 'dotted', fallback.dash),
  };
};

const pointsOf = (v: unknown): Pt[] =>
  Array.isArray(v) ? v.filter((p): p is Pt => !!p && isNum((p as Loose).x) && isNum((p as Loose).y)).map((p) => ({ x: p.x, y: p.y })) : [];

const portRef = (v: unknown) => {
  const r = (v && typeof v === 'object' ? v : null) as Loose | null;
  return r && isStr(r.id) && isStr(r.port) ? { id: r.id as string, port: r.port as string } : undefined;
};

/** Fill in defaults for a (possibly partial) shape model; null if it cannot be made sense of. */
export const normalizeShape = (raw: unknown): Shape | null => {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Loose;
  const id = pick(j.id, (v) => isStr(v) && (v as string).length > 0, newId());
  const groupId = pick<string | undefined>(j.groupId, isStr, undefined);
  const base = { id, ...(groupId ? { groupId } : {}) };
  switch (j.type) {
    case 'box': {
      const d = defaultBox();
      return {
        ...d,
        ...base,
        x: pick(j.x, isNum, 0),
        y: pick(j.y, isNum, 0),
        w: pick(j.w, isNum, 100),
        h: pick(j.h, isNum, 50),
        fill: pick(j.fill, isStr, d.fill),
        stroke: strokeOf(j.stroke, d.stroke),
        radius: pick(j.radius, isNum, d.radius),
        text: pick(j.text, isStr, d.text),
        fontSize: pick(j.fontSize, isNum, d.fontSize),
        textColor: pick(j.textColor, isStr, d.textColor),
        boldFirstLine: pick(j.boldFirstLine, isBool, d.boldFirstLine),
      };
    }
    case 'wire': {
      const d = defaultWire();
      const from = portRef(j.from), to = portRef(j.to);
      const points = pointsOf(j.points);
      if (points.length < 2 && !(from && to)) return null;
      return {
        ...d,
        ...base,
        points,
        stroke: strokeOf(j.stroke, d.stroke),
        arrowStart: pick(j.arrowStart, isBool, d.arrowStart),
        arrowEnd: pick(j.arrowEnd, isBool, d.arrowEnd),
        busWidth: Math.max(1, Math.round(pick(j.busWidth, isNum, 1))),
        ...(isStr(j.label) ? { label: j.label as string } : {}),
        ...(isNum(j.labelPos) ? { labelPos: j.labelPos } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      };
    }
    case 'text': {
      const d = defaultText();
      if (!isStr(j.text)) return null;
      return {
        ...d,
        ...base,
        x: pick(j.x, isNum, 0),
        y: pick(j.y, isNum, 0),
        text: j.text as string,
        fontSize: pick(j.fontSize, isNum, d.fontSize),
        color: pick(j.color, isStr, d.color),
        anchor: pick(j.anchor, (a) => a === 'start' || a === 'middle' || a === 'end', d.anchor),
        bold: pick(j.bold, isBool, d.bold),
      };
    }
    case 'dot':
      return { ...base, type: 'dot', x: pick(j.x, isNum, 0), y: pick(j.y, isNum, 0), r: pick(j.r, isNum, 2.8), color: pick(j.color, isStr, '#000000') };
    case 'raw':
      if (!isStr(j.markup)) return null;
      return {
        ...base,
        type: 'raw',
        markup: j.markup as string,
        dx: pick(j.dx, isNum, 0),
        dy: pick(j.dy, isNum, 0),
        bbox: pick(j.bbox, (b) => !!b && typeof b === 'object', { x: 0, y: 0, w: 0, h: 0 }),
      };
    case 'macro': {
      const kind = j.kind as MacroShape['kind'];
      if (kind === 'custom') {
        const def = j.custom as MacroShape['custom'];
        if (!def || !Array.isArray(def.shapes)) return null;
        const shapes = def.shapes.map(normalizeShape).filter((s): s is Shape => !!s);
        const t = MACRO_TEMPLATES[0].make({ x: 0, y: 0 }, { inputs: 2 });
        return {
          ...t,
          ...base,
          kind: 'custom',
          x: pick(j.x, isNum, 0),
          y: pick(j.y, isNum, 0),
          w: pick(def.w, isNum, 40),
          h: pick(def.h, isNum, 40),
          custom: { ...def, shapes, ports: Array.isArray(def.ports) ? def.ports : [] },
        };
      }
      const t = MACRO_TEMPLATES.find((m) => m.kind === kind);
      if (!t) return null;
      const inputs = Math.max(2, Math.round(pick(j.inputs, isNum, 2)));
      const d = t.make({ x: pick(j.x, isNum, 0), y: pick(j.y, isNum, 0) }, { inputs });
      const dir = pick(j.dir, (v) => v === 'right' || v === 'left' || v === 'down' || v === 'up', d.dir);
      // Default size follows the flow direction when not given.
      const turned = dir === 'down' || dir === 'up';
      return {
        ...d,
        ...base,
        dir,
        w: pick(j.w, isNum, turned ? d.h : d.w),
        h: pick(j.h, isNum, turned ? d.w : d.h),
        inputs,
        fill: pick(j.fill, isStr, d.fill),
        stroke: strokeOf(j.stroke, d.stroke),
        label: pick(j.label, isStr, d.label),
        fontSize: pick(j.fontSize, isNum, d.fontSize),
        textColor: pick(j.textColor, isStr, d.textColor),
        ctrlSide: pick(j.ctrlSide, (v) => v === 'top' || v === 'bottom', d.ctrlSide),
        showIndices: pick(j.showIndices, isBool, d.showIndices),
        enable: pick(j.enable, isBool, d.enable),
        reset: pick(j.reset, isBool, d.reset),
        symbol: pick(j.symbol, isStr, d.symbol),
        ...(Array.isArray(j.inPos) && j.inPos.every(isNum) ? { inPos: j.inPos as number[] } : {}),
        ...(isNum(j.slant) ? { slant: j.slant } : {}),
      };
    }
    default:
      return null;
  }
};

const portInfo = (doc: Doc, ref: WireShape['from']) => {
  const m = ref && doc.shapes[ref.id];
  return m?.type === 'macro' ? macroPorts(m).find((p) => p.name === ref!.port) ?? null : null;
};

/**
 * Wires given only as "from pin A to pin B" (or with diagonal segments) get
 * orthogonal routes that meet each pin the way it faces.
 */
export const routeConnections = (doc: Doc): Doc => {
  const shapes = { ...doc.shapes };
  for (const id of doc.order) {
    const w = shapes[id];
    if (w?.type !== 'wire') continue;
    const a = portInfo(doc, w.from), b = portInfo(doc, w.to);
    let pts = w.points.length >= 2 ? w.points : a && b ? [a.p, b.p] : w.points;
    if (a) pts = [a.p, ...pts.slice(1)];
    if (b) pts = [...pts.slice(0, -1), b.p];
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = out[out.length - 1], q = pts[i];
      if (p.x !== q.x && p.y !== q.y) {
        const startH = i === 1 && a ? a.horizontal : true;
        const endH = i === pts.length - 1 && b ? b.horizontal : startH;
        if (startH && endH) {
          const mx = snap((p.x + q.x) / 2, 10);
          out.push({ x: mx, y: p.y }, { x: mx, y: q.y });
        } else if (!startH && !endH) {
          const my = snap((p.y + q.y) / 2, 10);
          out.push({ x: p.x, y: my }, { x: q.x, y: my });
        } else out.push(startH ? { x: q.x, y: p.y } : { x: p.x, y: q.y });
      }
      out.push(q);
    }
    const tidy = out.filter((p, i) => i === 0 || p.x !== out[i - 1].x || p.y !== out[i - 1].y);
    if (tidy.length >= 2) shapes[id] = { ...w, points: tidy };
    else if (w.points.length < 2) delete shapes[id]; // pins it named do not exist
  }
  return syncConnections({ shapes, order: doc.order.filter((id) => shapes[id]) });
};
