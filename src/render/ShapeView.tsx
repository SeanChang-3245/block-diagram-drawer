// Shape rendering shared by the editor canvas and the SVG exporter, so what
// you see is exactly what gets saved.

import { DASH_ARRAY } from '../model/presets';
import { busMarkPosition, wireLabelLayout, WIRE_LABEL_SIZE } from '../model/geometry';
import { macroGeometry } from '../model/macros';
import { findJunctions } from '../model/junctions';
import type { BoxShape, Doc, MacroShape, Shape, WireShape } from '../model/types';

export const markerId = (color: string): string => `bdd-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

/** One arrowhead marker per wire color in use. */
export const ArrowMarkers = ({ doc }: { doc: Doc }) => {
  const colors = new Set<string>();
  for (const id of doc.order) {
    const s = doc.shapes[id];
    const inner = s?.type === 'macro' && s.custom ? s.custom.shapes : [];
    for (const w of [s, ...inner]) if (w?.type === 'wire' && (w.arrowEnd || w.arrowStart)) colors.add(w.stroke.color);
  }
  return (
    <defs>
      {[...colors].map((c) => (
        <marker
          key={c}
          id={markerId(c)}
          markerWidth={10}
          markerHeight={10}
          refX={8}
          refY={3}
          orient="auto-start-reverse"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={c} />
        </marker>
      ))}
    </defs>
  );
};

const BoxView = ({ s }: { s: BoxShape }) => {
  const lines = s.text.length ? s.text.split('\n') : [];
  const lh = s.fontSize * 1.2;
  const firstBaseline = s.y + s.h / 2 - (lines.length * lh) / 2 + s.fontSize * 0.85;
  return (
    <>
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        rx={s.radius || undefined}
        fill={s.fill}
        stroke={s.stroke.color}
        strokeWidth={s.stroke.width}
        strokeDasharray={DASH_ARRAY[s.stroke.dash]}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={s.x + s.w / 2}
          y={firstBaseline + i * lh}
          fontSize={s.fontSize}
          textAnchor="middle"
          fontWeight={s.boldFirstLine && i === 0 ? 'bold' : 'normal'}
          fill={s.textColor}
        >
          {line}
        </text>
      ))}
    </>
  );
};

const BusMark = ({ s }: { s: WireShape }) => {
  const pos = busMarkPosition(s.points);
  if (!pos || s.busWidth <= 1) return null;
  const { p, horizontal } = pos;
  const k = 5;
  return (
    <>
      <line x1={p.x - k + 1} y1={p.y + k} x2={p.x + k - 1} y2={p.y - k} stroke={s.stroke.color} strokeWidth={s.stroke.width} />
      <text
        x={horizontal ? p.x : p.x + k + 2}
        y={horizontal ? p.y - k - 3 : p.y + 3}
        fontSize={9}
        textAnchor={horizontal ? 'middle' : 'start'}
        fill={s.stroke.color}
      >
        {s.busWidth}
      </text>
    </>
  );
};

const WireView = ({ s }: { s: WireShape }) => (
  <>
    <polyline
      points={s.points.map((p) => `${p.x},${p.y}`).join(' ')}
      fill="none"
      stroke={s.stroke.color}
      strokeWidth={s.stroke.width}
      strokeDasharray={DASH_ARRAY[s.stroke.dash]}
      strokeLinejoin="miter"
      markerEnd={s.arrowEnd ? `url(#${markerId(s.stroke.color)})` : undefined}
      markerStart={s.arrowStart ? `url(#${markerId(s.stroke.color)})` : undefined}
    />
    <BusMark s={s} />
    <WireLabel s={s} />
  </>
);

const WireLabel = ({ s }: { s: WireShape }) => {
  const l = wireLabelLayout(s);
  if (!l) return null;
  return (
    <text x={l.x} y={l.y} fontSize={WIRE_LABEL_SIZE} textAnchor={l.anchor} fill={s.stroke.color}>
      {s.label}
    </text>
  );
};

const MacroView = ({ s }: { s: MacroShape }) => {
  const g = macroGeometry(s);
  const common = {
    fill: s.fill,
    stroke: s.stroke.color,
    strokeWidth: s.stroke.width,
    strokeDasharray: DASH_ARRAY[s.stroke.dash],
  };
  return (
    <>
      {g.outline.kind === 'circle' && <circle cx={g.outline.c.x} cy={g.outline.c.y} r={g.outline.r} {...common} />}
      {g.outline.kind === 'poly' && <path d={'M' + g.outline.pts.map((p) => `${p.x},${p.y}`).join(' L') + ' Z'} strokeLinejoin="miter" {...common} />}
      {s.kind === 'custom' && s.custom && (
        <g transform={`translate(${s.x},${s.y})`}>
          {s.custom.shapes.map((inner) => (
            <ShapeBody key={inner.id} s={inner} />
          ))}
        </g>
      )}
      {g.marks.map((m, i) => (
        <polyline key={i} points={m.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.stroke.color} strokeWidth={s.stroke.width * 0.8} />
      ))}
      {g.texts.map((t, i) => (
        <text key={i} x={t.p.x} y={t.p.y} fontSize={t.size} textAnchor={t.anchor} fontWeight={t.bold ? 'bold' : 'normal'} fill={s.textColor}>
          {t.text}
        </text>
      ))}
    </>
  );
};

/** Auto junction dots, drawn above all shapes. Not part of the model. */
export const JunctionDots = ({ doc }: { doc: Doc }) => (
  <g data-bdd-derived="junctions">
    {findJunctions(doc).map((j, i) => (
      <circle key={i} cx={j.p.x} cy={j.p.y} r={j.r} fill={j.color} />
    ))}
  </g>
);

const ShapeBody = ({ s }: { s: Shape }) => {
  switch (s.type) {
    case 'box':
      return <BoxView s={s} />;
    case 'wire':
      return <WireView s={s} />;
    case 'macro':
      return <MacroView s={s} />;
    case 'text':
      return (
        <text x={s.x} y={s.y} fontSize={s.fontSize} textAnchor={s.anchor} fontWeight={s.bold ? 'bold' : 'normal'} fill={s.color}>
          {s.text}
        </text>
      );
    case 'dot':
      return <circle cx={s.x} cy={s.y} r={s.r} fill={s.color} />;
    case 'raw':
      return <g transform={`translate(${s.dx},${s.dy})`} dangerouslySetInnerHTML={{ __html: s.markup }} />;
  }
};

/**
 * Each shape is wrapped in a <g> carrying its full model as JSON, which is how
 * a saved SVG reopens with every shape still editable.
 */
export const ShapeView = ({ s, embedModel }: { s: Shape; embedModel?: boolean }) => (
  <g data-bdd={s.type} data-bdd-json={embedModel ? JSON.stringify(s) : undefined} data-id={embedModel ? undefined : s.id}>
    <ShapeBody s={s} />
  </g>
);
