import { useEffect, useRef } from 'react';
import { useStore, useVisibleDoc, type View } from '../store';
import { GRID, FONT_FAMILY } from '../model/presets';
import { shapeBounds } from '../model/geometry';
import { macroPorts } from '../model/macros';
import type { Pt, Shape } from '../model/types';
import { ArrowMarkers, JunctionDots, ShapeView } from '../render/ShapeView';
import { doubleClick, pointerDown, pointerMove, pointerUp } from '../tools/interaction';
import { TextEditor } from './TextEditor';

const SEL = '#2f6fed';
const HOVER = '#f08c00';

export const toWorld = (view: View, sx: number, sy: number): Pt => ({ x: view.x + sx / view.zoom, y: view.y + sy / view.zoom });

export const zoomAt = (view: View, sx: number, sy: number, factor: number): View => {
  const zoom = Math.min(20, Math.max(0.05, view.zoom * factor));
  const w = toWorld(view, sx, sy);
  return { zoom, x: w.x - sx / zoom, y: w.y - sy / zoom };
};

const SelectionMark = ({ s, zoom }: { s: Shape; zoom: number }) => {
  const sw = 1 / zoom;
  if (s.type === 'wire') {
    const pts = s.points.map((p) => `${p.x},${p.y}`).join(' ');
    const k = 3 / zoom;
    return (
      <g pointerEvents="none">
        <polyline points={pts} fill="none" stroke={SEL} strokeOpacity={0.35} strokeWidth={6 / zoom} strokeLinejoin="round" />
        {s.points.map((p, i) => (
          <rect key={i} x={p.x - k} y={p.y - k} width={2 * k} height={2 * k} fill="#fff" stroke={SEL} strokeWidth={sw} />
        ))}
      </g>
    );
  }
  const b = shapeBounds(s);
  const pad = 3 / zoom;
  return (
    <rect
      pointerEvents="none"
      x={b.x - pad}
      y={b.y - pad}
      width={b.w + 2 * pad}
      height={b.h + 2 * pad}
      fill="none"
      stroke={SEL}
      strokeWidth={sw}
      strokeDasharray={`${4 / zoom} ${3 / zoom}`}
    />
  );
};

const Overlays = ({ zoom }: { zoom: number }) => {
  const overlay = useStore((s) => s.overlay);
  const doc = useVisibleDoc();
  const wireStroke = useStore((s) => s.wireStroke);
  const sw = 1 / zoom;
  const out: JSX.Element[] = [];
  if (overlay.band) {
    const r = overlay.band;
    out.push(<rect key="band" x={r.x} y={r.y} width={r.w} height={r.h} fill={SEL} fillOpacity={0.08} stroke={SEL} strokeWidth={sw} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />);
  }
  if (overlay.rectPreview) {
    const r = overlay.rectPreview;
    out.push(<rect key="rp" x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#000" strokeWidth={1.5} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />);
  }
  if (overlay.wirePreview) {
    out.push(
      <polyline
        key="wp"
        points={overlay.wirePreview.points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={wireStroke.color}
        strokeWidth={wireStroke.width}
        strokeOpacity={0.7}
        strokeDasharray={`${5 / zoom} ${3 / zoom}`}
      />,
    );
  }
  const h = overlay.hover;
  if (h) {
    const s = doc.shapes[h.id];
    if ((s?.type === 'box' || s?.type === 'macro') && h.kind === 'box') {
      const { x, y, w, h: hh } = s;
      const segs: [number, number, number, number][] = [];
      if (h.edges.l) segs.push([x, y, x, y + hh]);
      if (h.edges.r) segs.push([x + w, y, x + w, y + hh]);
      if (h.edges.t) segs.push([x, y, x + w, y]);
      if (h.edges.b) segs.push([x, y + hh, x + w, y + hh]);
      segs.forEach(([x1, y1, x2, y2], i) => out.push(<line key={`he${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={HOVER} strokeWidth={4 / zoom} />));
    } else if (s?.type === 'wire' && h.kind === 'wire') {
      const pts = h.points.map((i) => s.points[i]).filter(Boolean);
      if (pts.length >= 2) {
        out.push(<polyline key="hw" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={HOVER} strokeWidth={4 / zoom} />);
      } else if (pts.length === 1) {
        out.push(<circle key="hv" cx={pts[0].x} cy={pts[0].y} r={5 / zoom} fill="none" stroke={HOVER} strokeWidth={2 / zoom} />);
      }
    } else if (s) {
      const b = shapeBounds(s);
      out.push(<rect key="hs" x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={HOVER} strokeWidth={2 / zoom} />);
    }
  }
  if (overlay.ghost) {
    out.push(
      <g key="ghost" opacity={0.55}>
        <ShapeView s={overlay.ghost} />
      </g>,
    );
  }
  if (overlay.port) {
    out.push(<circle key="port" cx={overlay.port.x} cy={overlay.port.y} r={5 / zoom} fill="none" stroke={HOVER} strokeWidth={2 / zoom} />);
  }
  return <g pointerEvents="none">{out}</g>;
};

/** Padlock in the corner of shapes locked against auto layout (editor only, never exported). */
const LockBadges = ({ zoom }: { zoom: number }) => {
  const doc = useVisibleDoc();
  const k = 1 / zoom;
  return (
    <g pointerEvents="none">
      {doc.order.map((id) => {
        const s = doc.shapes[id];
        if (!s?.locked) return null;
        const b = shapeBounds(s);
        return (
          <g key={id} transform={`translate(${b.x + b.w - 2 * k},${b.y - 10 * k}) scale(${k})`}>
            <rect x={-1} y={3} width={10} height={8} rx={1.5} fill="#f08c00" />
            <path d="M1.5 3.5 V2 a2.5 2.5 0 0 1 5 0 V3.5" fill="none" stroke="#f08c00" strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
};

/** Port markers on every macro while a wire command is active. */
const PortMarks = ({ zoom }: { zoom: number }) => {
  const doc = useVisibleDoc();
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const wiring = tool === 'wire' || tool === 'bus';
  const r = 2.5 / zoom;
  return (
    <g pointerEvents="none">
      {doc.order.map((id) => {
        const m = doc.shapes[id];
        if (m?.type !== 'macro' || (!wiring && !selection.includes(id))) return null;
        return macroPorts(m).map((p) => (
          <rect key={`${id}:${p.name}`} x={p.p.x - r} y={p.p.y - r} width={2 * r} height={2 * r} fill="#fff" stroke={SEL} strokeWidth={1 / zoom} />
        ));
      })}
    </g>
  );
};

const Grid = ({ view, w, h }: { view: View; w: number; h: number }) => {
  const minor = GRID * view.zoom;
  const major = minor * 10;
  if (major < 20) return null;
  // Dots only once they are far enough apart to read; major lines stay longer.
  const showMinor = minor >= 7;
  const ox = -view.x * view.zoom, oy = -view.y * view.zoom;
  return (
    <>
      <defs>
        <pattern id="grid-minor" width={minor} height={minor} patternUnits="userSpaceOnUse" x={ox} y={oy}>
          <circle cx={0.5} cy={0.5} r={0.7} fill="#c7ccd6" />
        </pattern>
        <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse" x={ox} y={oy}>
          {showMinor && <rect width={major} height={major} fill="url(#grid-minor)" />}
          <path d={`M ${major} 0 L 0 0 0 ${major}`} fill="none" stroke="#e3e6ec" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#grid-major)" />
    </>
  );
};

export const Canvas = () => {
  const ref = useRef<HTMLDivElement>(null);
  const doc = useVisibleDoc();
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const gridVisible = useStore((s) => s.gridVisible);
  const size = useStore((s) => s.canvasSize);
  const pan = useRef<{ sx: number; sy: number; view: View } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => useStore.getState().set({ canvasSize: { w: el.clientWidth, h: el.clientHeight } }));
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = useStore.getState().view;
      // Wheel zooms like a layout editor; Shift+wheel pans sideways.
      if (e.shiftKey) {
        useStore.getState().setView({ ...v, x: v.x + (e.deltaY || e.deltaX) / v.zoom });
      } else {
        useStore.getState().setView(zoomAt(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { screen, world: toWorld(useStore.getState().view, screen.x, screen.y) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (useStore.getState().textEdit || useStore.getState().pendingLayout) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const { screen, world } = local(e);
    if (e.button === 1) {
      e.preventDefault();
      pan.current = { sx: screen.x, sy: screen.y, view: useStore.getState().view };
      return;
    }
    pointerDown(world, screen, e.button, e.shiftKey);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { screen, world } = local(e);
    if (pan.current) {
      const p = pan.current;
      useStore.getState().setView({ ...p.view, x: p.view.x - (screen.x - p.sx) / p.view.zoom, y: p.view.y - (screen.y - p.sy) / p.view.zoom });
      return;
    }
    useStore.getState().set({ cursor: world });
    pointerMove(world, screen, e.shiftKey);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current) {
      pan.current = null;
      return;
    }
    const { screen, world } = local(e);
    pointerUp(world, screen);
  };

  const cursor = tool === 'select' ? 'default' : 'crosshair';
  const selected = selection.map((id) => doc.shapes[id]).filter(Boolean);

  return (
    <div ref={ref} className="canvas" style={{ cursor }}>
      <svg
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => doubleClick(local(e).world)}
        onContextMenu={(e) => e.preventDefault()}
        fontFamily={FONT_FAMILY}
      >
        {gridVisible && <Grid view={view} w={size.w} h={size.h} />}
        <g transform={`scale(${view.zoom}) translate(${-view.x},${-view.y})`}>
          <ArrowMarkers doc={doc} />
          {doc.order.map((id) => doc.shapes[id] && <ShapeView key={id} s={doc.shapes[id]} />)}
          <JunctionDots doc={doc} />
          {selected.map((s) => (
            <SelectionMark key={s.id} s={s} zoom={view.zoom} />
          ))}
          <PortMarks zoom={view.zoom} />
          <LockBadges zoom={view.zoom} />
          <Overlays zoom={view.zoom} />
        </g>
      </svg>
      <TextEditor />
    </div>
  );
};
