// Tool state machine. The canvas feeds it pointer events in world coordinates;
// the global key handler calls escape/enter/space. Commands follow the
// layout-editor convention: a command stays armed until Esc, points are
// entered by clicking, and click-move-click works as well as press-drag-release.

import { TOOL_PROMPTS, useStore, type Placeable, type ToolName } from '../store';
import { defaultBox, defaultText, defaultWire } from '../model/presets';
import { hitShape, lRoute, projectOnto, rectContains, rectFromPts, rectInside, shapeBounds, simplifyPolyline, snapPt, wireLabelLayout } from '../model/geometry';
import {
  applyTargets,
  areaStretch,
  bindConnections,
  duplicate,
  expandGroups,
  finalizeTargets,
  moveTargets,
  pickStretch,
  type Target,
} from '../model/edits';
import { MACRO_TEMPLATES, macroPorts, type Port } from '../model/macros';
import { customInstance } from '../model/custom';
import { GRID } from '../model/presets';
import { newId, type Doc, type Pt, type Shape } from '../model/types';

type DragMode = 'move' | 'copy' | 'stretch';

type Phase =
  | { k: 'idle' }
  | { k: 'pressSelect'; start: Pt; startScreen: Pt; shift: boolean }
  | { k: 'band'; start: Pt; purpose: 'select' | 'stretch'; shift: boolean }
  | { k: 'awaitRef'; mode: DragMode; targets: Target[] }
  | { k: 'drag'; mode: DragMode; ref: Pt; base: Doc; targets: Target[]; pressed: boolean; downScreen: Pt; moved: boolean; select?: string[] }
  | { k: 'rect'; anchor: Pt; pressed: boolean; downScreen: Pt }
  | { k: 'wire'; points: Pt[]; hOverride: boolean | null; startH: boolean | null }
  | { k: 'label'; id: string; base: Doc };

const DRAG_THRESHOLD = 3; // screen px
const HIT_TOL = 5; // screen px
const PORT_SNAP = 8; // screen px

const st = () => useStore.getState();

let phase: Phase = { k: 'idle' };
/**
 * Area zoom (z) runs on top of whatever command is active, as in Virtuoso:
 * zoom mid-wire, then carry on routing.
 */
let zoomBox: { anchor: Pt | null; pressed: boolean; downScreen: Pt; prompt: string } | null = null;
let lastCursor: Pt = { x: 0, y: 0 };
let shiftHeld = false;

export const resetInteraction = () => {
  phase = { k: 'idle' };
  st().set({ overlay: {}, preview: null });
};

export const isBusy = () => phase.k !== 'idle' || zoomBox !== null;

export const startZoomBox = () => {
  zoomBox = { anchor: null, pressed: false, downScreen: { x: 0, y: 0 }, prompt: st().prompt };
  st().setPrompt('Zoom: drag a box, or click two corners, around the area to enlarge. Esc cancels.');
};

const endZoomBox = (area: { x: number; y: number; w: number; h: number } | null) => {
  const s = st();
  const prompt = zoomBox?.prompt ?? '';
  zoomBox = null;
  s.set({ overlay: { ...s.overlay, band: undefined } });
  s.setPrompt(prompt);
  if (!area) return;
  const { canvasSize: c, view } = s;
  if (area.w * view.zoom < DRAG_THRESHOLD && area.h * view.zoom < DRAG_THRESHOLD) {
    // A click instead of a box: zoom in 2x around that point.
    const zoom = Math.min(20, view.zoom * 2);
    return s.setView({ zoom, x: area.x - c.w / 2 / zoom, y: area.y - c.h / 2 / zoom });
  }
  const zoom = Math.min(20, c.w / Math.max(area.w, 1), c.h / Math.max(area.h, 1));
  s.setView({ zoom, x: area.x + area.w / 2 - c.w / 2 / zoom, y: area.y + area.h / 2 - c.h / 2 / zoom });
};

const tol = () => HIT_TOL / st().view.zoom;
const snapped = (p: Pt) => (st().snapOn ? snapPt(p, GRID) : p);

const hitTest = (doc: Doc, p: Pt): Shape | null => {
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const s = doc.shapes[doc.order[i]];
    if (hitShape(s, p, tol())) return s;
  }
  return null;
};

/** Nearest macro port within reach of the cursor. */
const nearPort = (doc: Doc, p: Pt): Port | null => {
  const reach = PORT_SNAP / st().view.zoom;
  let best: Port | null = null, bestD = reach;
  for (const id of doc.order) {
    const m = doc.shapes[id];
    if (m?.type !== 'macro') continue;
    for (const port of macroPorts(m)) {
      const d = Math.hypot(port.p.x - p.x, port.p.y - p.y);
      if (d <= bestD) {
        best = port;
        bestD = d;
      }
    }
  }
  return best;
};

/** Wire points snap to a nearby port first, then to the grid. */
const snapWire = (doc: Doc, p: Pt): Pt => nearPort(doc, p)?.p ?? snapped(p);

/** Is this drag moving exactly one wire end? Then it may land on a port. */
const draggingWireEnd = (doc: Doc, targets: Target[]): boolean => {
  const t = targets[0];
  if (targets.length !== 1 || t.kind !== 'wirePoints' || t.pts.length !== 1) return false;
  const w = doc.shapes[t.id];
  return w?.type === 'wire' && (t.pts[0].i === 0 || t.pts[0].i === w.points.length - 1);
};

/** Drag delta from the reference point, optionally locked to one axis. */
const delta = (ref: Pt, p: Pt, lock: boolean, snapTo: (p: Pt) => Pt = snapped): Pt => {
  const q = snapTo(p);
  let dx = q.x - ref.x, dy = q.y - ref.y;
  if (lock) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return { x: dx, y: dy };
};

const startDrag = (mode: DragMode, targets: Target[], ref: Pt, screen: Pt, pressed: boolean) => {
  let base = st().doc;
  let select: string[] | undefined;
  if (mode === 'copy') {
    const ids = targets.filter((t) => t.kind === 'move').map((t) => t.id);
    const dup = duplicate(base, ids, 0, 0);
    base = dup.doc;
    select = dup.ids;
    targets = dup.ids.map((id) => ({ kind: 'move', id }));
  }
  phase = { k: 'drag', mode, ref: snapped(ref), base, targets, pressed, downScreen: screen, moved: false, select };
  st().set({ preview: base, overlay: {} });
  st().setPrompt(pressed ? 'Release to drop, or keep moving.' : 'Click the destination point. Esc cancels.');
};

const finishDrag = () => {
  if (phase.k !== 'drag') return;
  const { mode, select } = phase;
  const preview = st().preview ?? phase.base;
  const result = finalizeTargets(preview, phase.targets);
  st().commit(result, select ? { select } : undefined);
  phase = { k: 'idle' };
  if (mode === 'stretch') {
    st().setPrompt('Stretched. Pick the next edge, or Esc to exit.');
  } else {
    st().setTool('select');
  }
};

const finishWire = () => {
  if (phase.k !== 'wire') return;
  const pts = simplifyPolyline(phase.points);
  phase = { k: 'idle' };
  st().set({ overlay: {} });
  if (pts.length < 2) return;
  const { wireStroke, busWidth, tool, doc, commit } = st();
  const wire = {
    ...defaultWire(),
    id: newId(),
    points: pts,
    stroke: { ...wireStroke },
    busWidth: tool === 'bus' ? busWidth : 1,
  };
  const next = bindConnections({ shapes: { ...doc.shapes, [wire.id]: wire }, order: [...doc.order, wire.id] }, [wire.id]);
  commit(next, { select: [wire.id] });
};

/** Shape the place command drops with its top-left corner at `at`. */
export const makePlaceable = (kind: Placeable, at: Pt, inputs: number): Shape => {
  if (kind === 'pipe') {
    return { ...defaultBox(), id: newId(), x: at.x, y: at.y, w: 20, h: 300, fill: '#d9d9d9', stroke: { color: '#000000', width: 1, dash: 'solid' } };
  }
  if (kind.startsWith('custom:')) {
    const def = st().library.find((d) => `custom:${d.id}` === kind);
    if (def) return customInstance(def, at);
    kind = 'mux';
  }
  const t = MACRO_TEMPLATES.find((m) => m.kind === kind)!;
  return { ...t.make(at, { inputs }), id: newId() };
};

const placeAt = (p: Pt) => {
  const { doc, commit, placing, muxInputs } = st();
  const shape = makePlaceable(placing, snapped(p), muxInputs);
  commit({ shapes: { ...doc.shapes, [shape.id]: shape }, order: [...doc.order, shape.id] }, { select: [shape.id] });
};

/** Topmost wire whose label is under the cursor. */
const hitLabel = (doc: Doc, p: Pt): string | null => {
  const t = tol();
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const w = doc.shapes[doc.order[i]];
    if (w?.type !== 'wire') continue;
    const l = wireLabelLayout(w);
    if (l && rectContains({ x: l.bounds.x - t, y: l.bounds.y - t, w: l.bounds.w + 2 * t, h: l.bounds.h + 2 * t }, p)) return w.id;
  }
  return null;
};

const createBox = (r: { x: number; y: number; w: number; h: number }) => {
  if (r.w < 1 || r.h < 1) return;
  const { doc, commit } = st();
  const box = { ...defaultBox(), id: newId(), ...r };
  commit({ shapes: { ...doc.shapes, [box.id]: box }, order: [...doc.order, box.id] }, { select: [box.id] });
};

/**
 * Points from the last wire point to the cursor. A port at either end decides
 * which way the segment touching it runs, so wires meet pins head-on; when
 * both ends want the same direction the route becomes a Z.
 */
const wirePreview = (points: Pt[], cursor: Pt, hOverride: boolean | null, endH: boolean | null, startH: boolean | null): Pt[] => {
  const last = points[points.length - 1];
  if (last.x === cursor.x || last.y === cursor.y) return [...points, cursor];
  const fromH = points.length === 1 ? startH : null;
  if (hOverride === null && fromH !== null && endH !== null && fromH === endH) {
    if (fromH) {
      const mx = snapped({ x: (last.x + cursor.x) / 2, y: 0 }).x;
      return [...points, { x: mx, y: last.y }, { x: mx, y: cursor.y }, cursor];
    }
    const my = snapped({ x: 0, y: (last.y + cursor.y) / 2 }).y;
    return [...points, { x: last.x, y: my }, { x: cursor.x, y: my }, cursor];
  }
  const hFirst = hOverride ?? (endH !== null ? !endH : fromH ?? Math.abs(cursor.x - last.x) >= Math.abs(cursor.y - last.y));
  return [...points, ...lRoute(last, cursor, hFirst)];
};

/** Hover feedback for the stretch command. */
const stretchHover = (p: Pt) => {
  const { doc, selection } = st();
  const picked = pickStretch(doc, p, tol(), new Set(selection));
  const t = picked?.[0];
  if (!t) return st().set({ overlay: {} });
  const hover =
    t.kind === 'boxEdges'
      ? { kind: 'box' as const, id: t.id, edges: t.edges }
      : t.kind === 'wirePoints'
        ? { kind: 'wire' as const, id: t.id, points: t.pts.map((q) => q.i) }
        : { kind: 'shape' as const, id: t.id };
  st().set({ overlay: { hover } });
};

export const pointerDown = (p: Pt, screen: Pt, button: number, shift: boolean) => {
  const s = st();
  const tool = s.tool;
  lastCursor = p;
  shiftHeld = shift;

  if (zoomBox) {
    if (button !== 0) return;
    if (!zoomBox.anchor) zoomBox = { ...zoomBox, anchor: p, pressed: true, downScreen: screen };
    else endZoomBox(rectFromPts(zoomBox.anchor, p));
    return;
  }

  // A pending click-move-click drag completes on the next click.
  if (phase.k === 'drag' && !phase.pressed) {
    if (button === 0) finishDrag();
    return;
  }

  if (tool === 'wire' || tool === 'bus') {
    if (button === 2) return finishWire();
    if (button !== 0) return;
    const port = nearPort(s.doc, p);
    const q = port?.p ?? snapped(p);
    if (phase.k === 'wire') {
      phase.points = wirePreview(phase.points, q, phase.hOverride, port?.horizontal ?? null, phase.startH);
      phase.hOverride = null;
    } else {
      phase = { k: 'wire', points: [q], hOverride: null, startH: port?.horizontal ?? null };
      s.setPrompt('Click the next point. Double-click, Enter or right-click to finish.');
    }
    s.set({ overlay: { wirePreview: { points: phase.points } } });
    return;
  }
  if (button !== 0) return;

  switch (tool) {
    case 'place':
      return placeAt(p);
    case 'rect': {
      const q = snapped(p);
      if (phase.k === 'rect') {
        createBox(rectFromPts(phase.anchor, q));
        phase = { k: 'idle' };
        s.set({ overlay: {} });
        return;
      }
      phase = { k: 'rect', anchor: q, pressed: true, downScreen: screen };
      s.setPrompt('Drag or click the opposite corner.');
      return;
    }
    case 'text': {
      const q = snapped(p);
      const t = { ...defaultText(), id: newId(), x: q.x, y: q.y, text: '' };
      s.commit({ shapes: { ...s.doc.shapes, [t.id]: t }, order: [...s.doc.order, t.id] }, { select: [t.id] });
      s.set({ textEdit: { id: t.id, isNew: true } });
      return;
    }
    case 'move':
    case 'copy': {
      if (phase.k === 'awaitRef') return startDrag(phase.mode, phase.targets, p, screen, true);
      const hit = hitTest(s.doc, p);
      if (!hit) return s.setPrompt('Nothing there. Click a shape to ' + tool + ' it.');
      const ids = expandGroups(s.doc, [hit.id]);
      s.setSelection(ids);
      return startDrag(tool, tool === 'move' ? moveTargets(s.doc, ids) : ids.map((id) => ({ kind: 'move', id })), p, screen, true);
    }
    case 'stretch': {
      if (phase.k === 'awaitRef') return startDrag('stretch', phase.targets, p, screen, true);
      const picked = pickStretch(s.doc, p, tol(), new Set(s.selection));
      if (picked) return startDrag('stretch', picked, p, screen, true);
      phase = { k: 'band', start: p, purpose: 'stretch', shift };
      return;
    }
    case 'select': {
      const labelOf = hitLabel(s.doc, p);
      if (labelOf) {
        s.setSelection([labelOf]);
        phase = { k: 'label', id: labelOf, base: s.doc };
        s.setPrompt('Slide the label along its wire.');
        return;
      }
      const hit = hitTest(s.doc, p);
      if (!hit) {
        phase = { k: 'band', start: p, purpose: 'select', shift };
        return;
      }
      const group = expandGroups(s.doc, [hit.id]);
      if (shift) {
        const inSel = s.selection.includes(hit.id);
        s.setSelection(inSel ? s.selection.filter((id) => !group.includes(id)) : [...s.selection, ...group]);
      } else if (!s.selection.includes(hit.id)) {
        s.setSelection(group);
      }
      phase = { k: 'pressSelect', start: p, startScreen: screen, shift };
      return;
    }
  }
};

export const pointerMove = (p: Pt, screen: Pt, shift: boolean): void => {
  const s = st();
  lastCursor = p;
  shiftHeld = shift;
  if (zoomBox) {
    if (zoomBox.anchor) s.set({ overlay: { ...s.overlay, band: rectFromPts(zoomBox.anchor, p) } });
    return;
  }
  switch (phase.k) {
    case 'idle':
      if (s.tool === 'stretch') stretchHover(p);
      else if (s.tool === 'place') s.set({ overlay: { ghost: makePlaceable(s.placing, snapped(p), s.muxInputs) } });
      else if (s.tool === 'wire' || s.tool === 'bus') {
        const port = nearPort(s.doc, p);
        s.set({ overlay: port ? { port: port.p } : {} });
      }
      return;
    case 'label': {
      const w = phase.base.shapes[phase.id];
      if (w?.type !== 'wire') return;
      const labelPos = Math.round(projectOnto(w.points, p) * 1000) / 1000;
      s.setPreview({ ...phase.base, shapes: { ...phase.base.shapes, [w.id]: { ...w, labelPos } } });
      return;
    }
    case 'awaitRef':
      return;
    case 'pressSelect': {
      if (Math.hypot(screen.x - phase.startScreen.x, screen.y - phase.startScreen.y) < DRAG_THRESHOLD) return;
      if (!s.selection.length) return;
      const ids = expandGroups(s.doc, s.selection);
      startDrag('move', moveTargets(s.doc, ids), phase.start, phase.startScreen, true);
      return pointerMove(p, screen, shift);
    }
    case 'band':
      s.set({ overlay: { band: rectFromPts(phase.start, p) } });
      return;
    case 'drag': {
      if (Math.hypot(screen.x - phase.downScreen.x, screen.y - phase.downScreen.y) >= DRAG_THRESHOLD) phase.moved = true;
      const endDrag = draggingWireEnd(phase.base, phase.targets);
      const d = delta(phase.ref, p, shift, endDrag ? (q) => snapWire(phase.k === 'drag' ? phase.base : s.doc, q) : snapped);
      s.setPreview(applyTargets(phase.base, phase.targets, d.x, d.y));
      if (endDrag) {
        const port = nearPort(phase.base, p);
        s.set({ overlay: port ? { port: port.p } : {} });
      }
      return;
    }
    case 'rect':
      s.set({ overlay: { rectPreview: rectFromPts(phase.anchor, snapped(p)) } });
      return;
    case 'wire': {
      const port = nearPort(s.doc, p);
      const points = wirePreview(phase.points, port?.p ?? snapped(p), phase.hOverride, port?.horizontal ?? null, phase.startH);
      s.set({ overlay: { wirePreview: { points }, ...(port ? { port: port.p } : {}) } });
      return;
    }
  }
};

export const pointerUp = (p: Pt, screen: Pt) => {
  const s = st();
  if (zoomBox) {
    if (zoomBox.anchor && zoomBox.pressed) {
      const moved = Math.hypot(screen.x - zoomBox.downScreen.x, screen.y - zoomBox.downScreen.y) >= DRAG_THRESHOLD;
      if (moved) endZoomBox(rectFromPts(zoomBox.anchor, p));
      else zoomBox.pressed = false;
    }
    return;
  }
  switch (phase.k) {
    case 'pressSelect':
      phase = { k: 'idle' };
      return;
    case 'label': {
      const preview = s.preview;
      phase = { k: 'idle' };
      if (preview) s.commit(preview);
      s.setPrompt(TOOL_PROMPTS.select);
      return;
    }
    case 'band': {
      const r = rectFromPts(phase.start, p);
      const tiny = r.w * s.view.zoom < DRAG_THRESHOLD && r.h * s.view.zoom < DRAG_THRESHOLD;
      s.set({ overlay: {} });
      if (phase.purpose === 'select') {
        const inside = tiny ? [] : s.doc.order.filter((id) => rectInside(shapeBounds(s.doc.shapes[id]), r));
        const ids = expandGroups(s.doc, inside);
        s.setSelection(phase.shift ? [...new Set([...s.selection, ...ids])] : ids);
        phase = { k: 'idle' };
        return;
      }
      phase = { k: 'idle' };
      if (tiny) return s.setPrompt('Nothing to stretch there. Click an edge or drag a box.');
      const targets = areaStretch(s.doc, r);
      if (!targets.length) return s.setPrompt('No edges or vertices inside that box.');
      phase = { k: 'awaitRef', mode: 'stretch', targets };
      return s.setPrompt(`Stretching ${targets.length} item(s): click a reference point.`);
    }
    case 'drag':
      if (!phase.pressed) return;
      if (phase.moved) return finishDrag();
      // A click without movement: switch to click-move-click.
      phase.pressed = false;
      s.setPrompt('Click the destination point. Esc cancels.');
      return;
    case 'rect': {
      const moved = Math.hypot(screen.x - phase.downScreen.x, screen.y - phase.downScreen.y) >= DRAG_THRESHOLD;
      if (moved) {
        createBox(rectFromPts(phase.anchor, snapped(p)));
        phase = { k: 'idle' };
        s.set({ overlay: {} });
        s.setPrompt('Rectangle: click or drag to set the first corner.');
      } else {
        phase.pressed = false;
      }
      return;
    }
  }
};

export const doubleClick = (p: Pt) => {
  const s = st();
  if (zoomBox) return;
  if (phase.k === 'wire') return finishWire();
  if (s.tool !== 'select') return;
  const hit = hitTest(s.doc, p);
  if (hit && (hit.type === 'box' || hit.type === 'text')) {
    s.setSelection([hit.id]);
    s.set({ textEdit: { id: hit.id, isNew: false } });
  }
};

/** Esc: cancel the running step, then leave the command, then drop the selection. */
export const escape = () => {
  const s = st();
  if (zoomBox) return endZoomBox(null);
  if (phase.k !== 'idle') {
    resetInteraction();
    s.setPrompt('Cancelled. ' + (s.tool === 'select' ? '' : 'Esc again to exit the command.'));
    return;
  }
  if (s.tool !== 'select') return s.setTool('select');
  s.setSelection([]);
};

export const enter = () => {
  if (phase.k === 'wire') finishWire();
};

/** Space while routing a wire flips which way the next bend goes. */
export const space = (): boolean => {
  if (phase.k !== 'wire') return false;
  const last = phase.points[phase.points.length - 1];
  const auto = Math.abs(lastCursor.x - last.x) >= Math.abs(lastCursor.y - last.y);
  phase.hOverride = !(phase.hOverride ?? auto);
  pointerMove(lastCursor, { x: 0, y: 0 }, shiftHeld);
  return true;
};

/** Arm a command. Move/copy/stretch with a selection skip straight to "pick a reference point". */
export const armTool = (tool: ToolName) => {
  const s = st();
  resetInteraction();
  s.setTool(tool);
  if ((tool === 'move' || tool === 'copy') && s.selection.length) {
    const ids = expandGroups(s.doc, s.selection);
    const targets: Target[] = tool === 'move' ? moveTargets(s.doc, ids) : ids.map((id) => ({ kind: 'move', id }));
    phase = { k: 'awaitRef', mode: tool, targets };
    s.setPrompt(`${tool === 'move' ? 'Move' : 'Copy'} ${ids.length} shape(s): click a reference point.`);
  }
};

export const cursorWorld = () => lastCursor;
