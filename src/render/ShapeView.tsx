// Shape rendering shared by the editor canvas and the SVG exporter, so what
// you see is exactly what gets saved.

import { DASH_ARRAY } from '../model/presets';
import { busMarkPosition } from '../model/geometry';
import type { BoxShape, Doc, Shape, WireShape } from '../model/types';

export const markerId = (color: string): string => `bdd-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

/** One arrowhead marker per wire color in use. */
export const ArrowMarkers = ({ doc }: { doc: Doc }) => {
  const colors = new Set<string>();
  for (const id of doc.order) {
    const s = doc.shapes[id];
    if (s?.type === 'wire' && (s.arrowEnd || s.arrowStart)) colors.add(s.stroke.color);
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
  </>
);

const ShapeBody = ({ s }: { s: Shape }) => {
  switch (s.type) {
    case 'box':
      return <BoxView s={s} />;
    case 'wire':
      return <WireView s={s} />;
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
