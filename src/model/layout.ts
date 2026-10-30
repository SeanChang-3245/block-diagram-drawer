// Automatic placement with ELK's layered algorithm (the one netlistsvg uses
// for Yosys netlists): blocks become nodes with fixed pin positions, wires
// become edges, branches of one signal are merged into a hyperedge, and
// pipeline registers can split the diagram into stage columns.

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import { distToSegment, shapeBounds, simplifyPolyline, unionRects, type Rect } from './geometry';
import { bindConnections, expandGroups, placeWirePoints, syncConnections, translateShape } from './edits';
import { macroPorts } from './macros';
import { rerouteWire } from './router';
import type { Doc, Pt, Shape, WireShape } from './types';

export interface LayoutOptions {
  direction: 'RIGHT' | 'DOWN';
  /** Space between blocks, in user units. */
  spacing: number;
  /** Use pipeline registers (tall thin boxes) as stage boundaries. */
  stages: boolean;
}

export const DEFAULT_LAYOUT: LayoutOptions = { direction: 'RIGHT', spacing: 40, stages: true };

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

type Side = 'WEST' | 'EAST' | 'NORTH' | 'SOUTH';

const isBlock = (s: Shape | undefined): s is Extract<Shape, { type: 'box' | 'macro' }> => s?.type === 'box' || s?.type === 'macro';

/** Tall thin boxes are read as pipeline registers. */
export const isPipelineRegister = (s: Shape) => s.type === 'box' && s.h >= 4 * s.w && s.w <= 40;

const onBorder = (r: Rect, p: Pt): Side | null => {
  const e = 0.01;
  const inY = p.y >= r.y - e && p.y <= r.y + r.h + e, inX = p.x >= r.x - e && p.x <= r.x + r.w + e;
  if (inY && Math.abs(p.x - r.x) < e) return 'WEST';
  if (inY && Math.abs(p.x - r.x - r.w) < e) return 'EAST';
  if (inX && Math.abs(p.y - r.y) < e) return 'NORTH';
  if (inX && Math.abs(p.y - r.y - r.h) < e) return 'SOUTH';
  return null;
};

/** One end of a wire as ELK sees it: a pin on a node. */
interface End {
  node: string;
  port: string;
  side: Side;
  /** Offset of the pin from the node's top-left corner. */
  dx: number;
  dy: number;
}

const sameEnd = (p: Pt, w: WireShape) => [w.points[0], w.points[w.points.length - 1]].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.01);

const onWire = (p: Pt, w: WireShape) => w.points.some((q, i) => i + 1 < w.points.length && distToSegment(p, q, w.points[i + 1]) < 0.01);

/**
 * Lay out the blocks in `scope` (whole diagram when null). Locked blocks and
 * everything outside the scope stay put; wires between laid-out blocks take
 * ELK's routes, other wires attached to them are re-routed.
 */
export const autoLayout = async (doc: Doc, scope: string[] | null, opts: LayoutOptions = DEFAULT_LAYOUT): Promise<Doc> => {
  const inScope = new Set(scope ? expandGroups(doc, scope) : doc.order);
  const nodes = doc.order.filter((id) => inScope.has(id) && isBlock(doc.shapes[id]) && !doc.shapes[id].locked);
  if (!nodes.length) return doc;
  const nodeSet = new Set(nodes);
  const wires = doc.order.map((id) => doc.shapes[id]).filter((s): s is WireShape => s?.type === 'wire');

  // Pins of every node: macro pins plus one pin per wire end resting on a box border.
  const ports = new Map<string, ElkPort[]>(nodes.map((id) => [id, []]));
  const portIndex = new Map<string, End>();
  const addPort = (e: End) => {
    const key = `${e.node}/${e.port}`;
    if (!portIndex.has(key)) {
      portIndex.set(key, e);
      ports.get(e.node)!.push({ id: key, x: e.dx, y: e.dy, width: 0, height: 0, layoutOptions: { 'elk.port.side': e.side } });
    }
    return key;
  };
  for (const id of nodes) {
    const m = doc.shapes[id];
    if (m.type !== 'macro') continue;
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    for (const p of macroPorts(m)) {
      const side: Side = p.horizontal ? (p.p.x < cx ? 'WEST' : 'EAST') : p.p.y < cy ? 'NORTH' : 'SOUTH';
      addPort({ node: id, port: p.name, side, dx: p.p.x - m.x, dy: p.p.y - m.y });
    }
  }

  /** The wire a branch starts on (its start lies on another wire, not at that wire's ends). */
  const trunkOf = (w: WireShape): WireShape | undefined => {
    const p = w.points[0];
    return wires.find((t) => t !== w && onWire(p, t) && !sameEnd(p, t));
  };

  /** Where a wire end attaches, following branch wires back to their trunk's source. */
  const endOf = (w: WireShape, which: 'from' | 'to', depth = 0): End | null => {
    const ref = w[which];
    const p = which === 'from' ? w.points[0] : w.points[w.points.length - 1];
    if (ref && nodeSet.has(ref.id)) {
      const e = portIndex.get(`${ref.id}/${ref.port}`);
      if (e) return e;
    }
    for (const id of nodes) {
      const s = doc.shapes[id];
      const side = s.type === 'box' ? onBorder(s, p) : null;
      if (s.type === 'box' && side) {
        const e: End = { node: id, port: `${w.id}:${which}`, side, dx: p.x - s.x, dy: p.y - s.y };
        addPort(e);
        return e;
      }
    }
    if (which === 'from' && depth < 6) {
      const trunk = trunkOf(w);
      if (trunk) return endOf(trunk, 'from', depth + 1);
    }
    return null;
  };

  const edges: ElkExtendedEdge[] = [];
  const edgeWire = new Map<string, WireShape>();
  for (const w of wires) {
    if (w.points.length < 2) continue;
    let a = endOf(w, 'from'), b = endOf(w, 'to');
    if (!a || !b || a.node === b.node) continue;
    // Edges point downstream so layering follows the signal flow.
    if (w.arrowStart && !w.arrowEnd) [a, b] = [b, a];
    const id = `e:${w.id}`;
    edges.push({ id, sources: [`${a.node}/${a.port}`], targets: [`${b.node}/${b.port}`] });
    edgeWire.set(id, w);
  }

  // Stage columns: blocks are numbered by how many pipeline registers lie upstream of them.
  const horizontal = opts.direction === 'RIGHT';
  const centre = (id: string) => {
    const r = shapeBounds(doc.shapes[id]);
    return horizontal ? r.x + r.w / 2 : r.y + r.h / 2;
  };
  const regs = nodes.filter((id) => isPipelineRegister(doc.shapes[id])).map(centre).sort((x, y) => x - y);
  const partition = (id: string) => {
    if (!opts.stages || !regs.length) return undefined;
    const c = centre(id);
    const before = regs.filter((r) => r < c - 0.5).length;
    return isPipelineRegister(doc.shapes[id]) ? 2 * before + 1 : 2 * before;
  };

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': opts.direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(opts.spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(opts.spacing * 1.5)),
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '10',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.mergeEdges': 'true',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.partitioning.activate': String(opts.stages && regs.length > 0),
    },
    children: nodes.map((id) => {
      const s = doc.shapes[id] as Extract<Shape, { type: 'box' | 'macro' }>;
      const part = partition(id);
      return {
        id,
        width: s.w,
        height: s.h,
        ports: ports.get(id),
        layoutOptions: {
          'elk.portConstraints': 'FIXED_POS',
          ...(part !== undefined ? { 'elk.partitioning.partition': String(part) } : {}),
        },
      };
    }),
    edges,
  };

  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const out = await new ELK().layout(graph);

  // Keep the laid-out block where the original blocks were.
  const before = unionRects(nodes.map((id) => shapeBounds(doc.shapes[id])))!;
  const placed = new Map((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  const after = unionRects(nodes.map((id) => ({ ...placed.get(id)!, w: (doc.shapes[id] as { w: number }).w, h: (doc.shapes[id] as { h: number }).h })))!;
  const ox = before.x - after.x, oy = before.y - after.y;

  const shapes = { ...doc.shapes };
  const delta = new Map<string, Pt>();
  for (const id of nodes) {
    const s = doc.shapes[id] as Extract<Shape, { type: 'box' | 'macro' }>;
    const p = placed.get(id)!;
    const d = { x: snap(p.x + ox) - s.x, y: snap(p.y + oy) - s.y };
    delta.set(id, d);
    shapes[id] = translateShape(s, d.x, d.y);
    // Captions and pin labels grouped with a block travel with it.
    if (s.groupId) {
      for (const g of doc.order) {
        const t = doc.shapes[g];
        if (t.groupId === s.groupId && !nodeSet.has(g) && t.type !== 'wire') shapes[g] = translateShape(t, d.x, d.y);
      }
    }
  }

  // Wires laid out by ELK take its route, with the ends pinned to where the (grid-snapped) pins really are.
  const routed = new Set<string>();
  const sections = new Map<string, Pt[]>();
  for (const e of out.edges ?? []) {
    const w = edgeWire.get(e.id);
    const sec = e.sections?.[0];
    if (!w || !sec) continue;
    let pts: Pt[] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: Math.round(p.x + ox), y: Math.round(p.y + oy) }));
    const reversed = w.arrowStart && !w.arrowEnd;
    if (reversed) pts = pts.reverse();
    sections.set(w.id, pts);
  }
  const portPos = (end: End): Pt => {
    const s = shapes[end.node] as Extract<Shape, { type: 'box' | 'macro' }>;
    return { x: s.x + end.dx, y: s.y + end.dy };
  };
  for (const [id, pts] of sections) {
    const w = doc.shapes[id] as WireShape;
    const a = endOf(w, 'from'), b = endOf(w, 'to');
    if (!a || !b) continue;
    const fixed = new Map<number, Pt>([[0, portPos(a)], [pts.length - 1, portPos(b)]]);
    let next = placeWirePoints({ ...w, points: pts }, fixed);
    next = { ...next, points: simplifyPolyline(next.points) };
    shapes[id] = next;
    routed.add(id);
  }

  // Branches were laid out as part of their trunk; start them where they leave it again.
  for (const id of routed) {
    const trunk = trunkOf(doc.shapes[id] as WireShape);
    if (!trunk || !routed.has(trunk.id)) continue;
    const w = shapes[id] as WireShape;
    shapes[id] = { ...w, points: trimAlong(w.points, (shapes[trunk.id] as WireShape).points) };
  }

  let next: Doc = { ...doc, shapes };
  next = bindConnections(next, [...routed]);
  next = syncConnections(next, new Set([...routed].flatMap((id) => [`${id}:start`, `${id}:end`])));
  // Other wires touching moved blocks get a fresh route around the new placement.
  for (const w of wires) {
    if (routed.has(w.id)) continue;
    const cur = next.shapes[w.id] as WireShape;
    const ends = [cur.from?.id, cur.to?.id];
    const touchesMoved = ends.some((e) => e && delta.has(e)) || nodes.some((n) => [cur.points[0], cur.points.at(-1)!].some((p) => onBorder(shapeBounds(doc.shapes[n]), p)));
    if (touchesMoved && !cur.manual) next = { ...next, shapes: { ...next.shapes, [w.id]: rerouteWire(next, cur) } };
  }
  return next;
};

/** Drop the part of `branch` that runs along `trunk`, so it starts where the two part ways. */
const trimAlong = (branch: Pt[], trunk: Pt[]): Pt[] => {
  const on = (p: Pt) => trunk.some((q, i) => i + 1 < trunk.length && distToSegment(p, q, trunk[i + 1]) < 0.01);
  let cut = 0;
  let at: Pt = branch[0];
  for (let i = 0; i + 1 < branch.length; i++) {
    const a = branch[i], b = branch[i + 1];
    if (!on(a)) break;
    if (on(b) && on({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) {
      cut = i + 1;
      at = b;
      continue;
    }
    // Walk to the farthest trunk vertex on this segment that is still shared.
    const cands = trunk.filter((q) => distToSegment(q, a, b) < 0.01).sort((p, q) => Math.hypot(q.x - a.x, q.y - a.y) - Math.hypot(p.x - a.x, p.y - a.y));
    const shared = cands.find((q) => on({ x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 }));
    if (shared) {
      cut = i;
      at = shared;
    }
    break;
  }
  const rest = [at, ...branch.slice(cut + 1)];
  return rest.length >= 2 ? simplifyPolyline(rest) : branch;
};
