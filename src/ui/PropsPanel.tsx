import { useStore } from '../store';
import { LINE_PRESETS } from '../model/presets';
import { DEFAULT_LABEL_POS } from '../model/geometry';
import { flowSize } from '../model/macros';
import { addToLibrary, arrangeSelection, explodeSelection, makeMacro, rotateSelection, toggleLock } from './commands';
import type { BoxShape, Dash, Direction, DotShape, MacroShape, Shape, Stroke, TextAnchor, TextShape, WireShape } from '../model/types';

let colorCtx: CanvasRenderingContext2D | null = null;
/** Normalize any CSS color to #rrggbb for <input type="color">. */
const toHex = (c: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((ch) => ch + ch).join('');
  colorCtx ??= document.createElement('canvas').getContext('2d');
  if (!colorCtx) return '#000000';
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = c;
  return colorCtx.fillStyle.startsWith('#') ? colorCtx.fillStyle : '#000000';
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="prop-row">
    <span>{label}</span>
    <div className="prop-ctl">{children}</div>
  </label>
);

const Num = ({ value, onChange, step = 1, min }: { value: number; onChange: (v: number) => void; step?: number; min?: number }) => (
  <input
    type="number"
    value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ''}
    step={step}
    min={min}
    onChange={(e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) onChange(v);
    }}
  />
);

const Color = ({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) => {
  const none = value === 'none';
  return (
    <>
      <input type="color" value={none ? '#ffffff' : toHex(value)} disabled={none} onChange={(e) => onChange(e.target.value)} />
      {allowNone && (
        <label className="inline">
          <input type="checkbox" checked={none} onChange={(e) => onChange(e.target.checked ? 'none' : '#ffffff')} /> none
        </label>
      )}
    </>
  );
};

const Toggle = ({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="inline">
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
  </label>
);

const DashSelect = ({ value, onChange }: { value: Dash; onChange: (v: Dash) => void }) => (
  <div className="seg">
    {(['solid', 'dashed', 'dotted'] as Dash[]).map((d) => (
      <button key={d} type="button" className={value === d ? 'on' : ''} onClick={() => onChange(d)} title={d}>
        <svg width="28" height="10">
          <line x1="2" y1="5" x2="26" y2="5" stroke="currentColor" strokeWidth="1.6" strokeDasharray={d === 'dashed' ? '5 3' : d === 'dotted' ? '1.5 2.5' : undefined} />
        </svg>
      </button>
    ))}
  </div>
);

type Patch<T> = (fn: (s: T) => T, key?: string) => void;

const StrokeFields = <T extends { stroke: Stroke }>({ first, patch, label }: { first: T; patch: Patch<T>; label: string }) => (
  <>
    <Row label={`${label} color`}>
      <Color value={first.stroke.color} allowNone={label === 'Border'} onChange={(color) => patch((s) => ({ ...s, stroke: { ...s.stroke, color } }), 'stroke-color')} />
    </Row>
    <Row label={`${label} width`}>
      <Num value={first.stroke.width} step={0.1} min={0.1} onChange={(width) => patch((s) => ({ ...s, stroke: { ...s.stroke, width } }), 'stroke-width')} />
    </Row>
    <Row label="Style">
      <DashSelect value={first.stroke.dash} onChange={(dash) => patch((s) => ({ ...s, stroke: { ...s.stroke, dash } }))} />
    </Row>
  </>
);

const BoxFields = ({ first, patch }: { first: BoxShape; patch: Patch<BoxShape> }) => (
  <>
    <Row label="Text">
      <textarea rows={3} value={first.text} onChange={(e) => patch((s) => ({ ...s, text: e.target.value }), 'box-text')} />
    </Row>
    <Row label="Font size">
      <Num value={first.fontSize} min={4} onChange={(fontSize) => patch((s) => ({ ...s, fontSize }), 'box-fs')} />
      <Toggle label="bold 1st line" value={first.boldFirstLine} onChange={(boldFirstLine) => patch((s) => ({ ...s, boldFirstLine }))} />
    </Row>
    <Row label="Text color">
      <Color value={first.textColor} onChange={(textColor) => patch((s) => ({ ...s, textColor }), 'box-tc')} />
    </Row>
    <Row label="Fill">
      <Color value={first.fill} allowNone onChange={(fill) => patch((s) => ({ ...s, fill }), 'box-fill')} />
    </Row>
    <StrokeFields first={first} patch={patch} label="Border" />
    <Row label="Corner radius">
      <Num value={first.radius} min={0} onChange={(radius) => patch((s) => ({ ...s, radius }), 'box-r')} />
    </Row>
    <Row label="X / Y">
      <Num value={first.x} onChange={(x) => patch((s) => ({ ...s, x }), 'box-x')} />
      <Num value={first.y} onChange={(y) => patch((s) => ({ ...s, y }), 'box-y')} />
    </Row>
    <Row label="W / H">
      <Num value={first.w} min={1} onChange={(w) => patch((s) => ({ ...s, w }), 'box-w')} />
      <Num value={first.h} min={1} onChange={(h) => patch((s) => ({ ...s, h }), 'box-h')} />
    </Row>
  </>
);

const WireFields = ({ first, patch }: { first: WireShape; patch: Patch<WireShape> }) => (
  <>
    <Row label="Preset">
      <div className="seg">
        {LINE_PRESETS.map((p) => (
          <button key={p.key} type="button" title={`${p.name} (${p.key})`} onClick={() => patch((s) => ({ ...s, stroke: { ...p.stroke } }))}>
            <svg width="22" height="10">
              <line x1="1" y1="5" x2="21" y2="5" stroke={p.stroke.color} strokeWidth="2" strokeDasharray={p.stroke.dash === 'dashed' ? '4 2' : undefined} />
            </svg>
          </button>
        ))}
      </div>
    </Row>
    <StrokeFields first={first} patch={patch} label="Line" />
    <Row label="Arrows">
      <Toggle label="start" value={first.arrowStart} onChange={(arrowStart) => patch((s) => ({ ...s, arrowStart }))} />
      <Toggle label="end" value={first.arrowEnd} onChange={(arrowEnd) => patch((s) => ({ ...s, arrowEnd }))} />
    </Row>
    <Row label="Bus width">
      <Num value={first.busWidth} min={1} onChange={(busWidth) => patch((s) => ({ ...s, busWidth: Math.max(1, Math.round(busWidth)) }), 'bus')} />
    </Row>
    <Row label="Label">
      <input type="text" value={first.label ?? ''} placeholder="signal name" onChange={(e) => patch((s) => ({ ...s, label: e.target.value }), 'wire-label')} />
    </Row>
    {first.label && (
      <Row label="Label at">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={first.labelPos ?? DEFAULT_LABEL_POS}
          onChange={(e) => patch((s) => ({ ...s, labelPos: Number(e.target.value) }), 'wire-label-pos')}
        />
      </Row>
    )}
    {(first.from || first.to) && (
      <p className="muted small">
        Attached to {[first.from && `${first.from.port} (start)`, first.to && `${first.to.port} (end)`].filter(Boolean).join(', ')}. Ends follow the macro.
      </p>
    )}
  </>
);

const DIRS: { d: Direction; label: string }[] = [
  { d: 'right', label: '→' },
  { d: 'down', label: '↓' },
  { d: 'left', label: '←' },
  { d: 'up', label: '↑' },
];

const MacroFields = ({ first, patch }: { first: MacroShape; patch: Patch<MacroShape> }) => {
  const { L, T } = flowSize(first);
  return (
    <>
      {first.kind === 'mux' && (
        <>
          <Row label="Inputs">
            <Num
              value={first.inputs}
              min={2}
              onChange={(v) =>
                patch((s) => {
                  const inputs = Math.max(2, Math.round(v));
                  // Keep 20 units per input so the input ports stay on the grid.
                  const across = Math.max(inputs * 20, flowSize(s).T * (inputs / s.inputs) || inputs * 20);
                  const t = Math.round(across / 20) * 20;
                  // A new input count means even spacing again.
                  const next = { ...s, inputs, inPos: undefined };
                  return s.dir === 'right' || s.dir === 'left' ? { ...next, h: t } : { ...next, w: t };
                }, 'mux-n')
              }
            />
            <Toggle label="show 0..N-1" value={first.showIndices} onChange={(showIndices) => patch((s) => ({ ...s, showIndices }))} />
          </Row>
        </>
      )}
      {(first.kind === 'mux' || first.kind === 'alu' || first.kind === 'op') && (
        <Row label={first.kind === 'mux' ? 'Select pin' : first.kind === 'alu' ? 'Op pin' : '2nd input'}>
          <div className="seg">
            {(['top', 'bottom'] as const).map((side) => (
              <button key={side} type="button" className={first.ctrlSide === side ? 'on' : ''} onClick={() => patch((s) => ({ ...s, ctrlSide: side }))}>
                {side}
              </button>
            ))}
          </div>
        </Row>
      )}
      {first.kind === 'reg' && (
        <Row label="Pins">
          <Toggle label="enable" value={first.enable} onChange={(enable) => patch((s) => ({ ...s, enable }))} />
          <Toggle label="reset" value={first.reset} onChange={(reset) => patch((s) => ({ ...s, reset }))} />
        </Row>
      )}
      {first.kind === 'op' ? (
        <Row label="Symbol">
          <div className="seg">
            {['+', '−', '×', '⊕', '&', '|', '='].map((sym) => (
              <button key={sym} type="button" className={first.symbol === sym ? 'on' : ''} onClick={() => patch((s) => ({ ...s, symbol: sym }))}>
                {sym}
              </button>
            ))}
          </div>
        </Row>
      ) : (
        <>
          <Row label="Label">
            <textarea rows={2} value={first.label} onChange={(e) => patch((s) => ({ ...s, label: e.target.value }), 'macro-label')} />
          </Row>
          <Row label="Font size">
            <Num value={first.fontSize} min={4} onChange={(fontSize) => patch((s) => ({ ...s, fontSize }), 'macro-fs')} />
          </Row>
        </>
      )}
      <Row label="Flow">
        <div className="seg">
          {DIRS.map(({ d, label }) => (
            <button
              key={d}
              type="button"
              className={first.dir === d ? 'on' : ''}
              title={d}
              onClick={() =>
                patch((s) => {
                  const wasHorizontal = s.dir === 'right' || s.dir === 'left';
                  const isHorizontal = d === 'right' || d === 'left';
                  return wasHorizontal === isHorizontal ? { ...s, dir: d } : { ...s, dir: d, w: s.h, h: s.w };
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" title="Rotate 90° (Shift+R)" onClick={rotateSelection}>⟳</button>
      </Row>
      <Row label="Fill">
        <Color value={first.fill} allowNone onChange={(fill) => patch((s) => ({ ...s, fill }), 'macro-fill')} />
      </Row>
      <StrokeFields first={first} patch={patch} label="Border" />
      <Row label="X / Y">
        <Num value={first.x} onChange={(x) => patch((s) => ({ ...s, x }), 'macro-x')} />
        <Num value={first.y} onChange={(y) => patch((s) => ({ ...s, y }), 'macro-y')} />
      </Row>
      <Row label="Length / width">
        <span className="muted small">
          {L} × {T}
        </span>
        <span className="muted small">(stretch with S)</span>
      </Row>
    </>
  );
};

const CustomFields = ({ first }: { first: MacroShape }) => {
  const inLibrary = useStore((s) => s.library.some((d) => d.id === first.custom?.id));
  const def = first.custom;
  if (!def) return null;
  return (
    <>
      <Row label="Name">
        <span>{def.name}</span>
      </Row>
      <Row label="Pins">
        <span className="muted small">{def.ports.length ? def.ports.map((p) => p.name).join(', ') : 'none'}</span>
      </Row>
      <Row label="X / Y">
        <span className="muted small">
          {first.x}, {first.y} ({def.w} × {def.h})
        </span>
      </Row>
      <div className="seg arrange">
        <button type="button" onClick={explodeSelection} title="Turn back into ordinary shapes">Explode</button>
        {!inLibrary && (
          <button type="button" onClick={() => addToLibrary(def)} title="Keep this macro in your library for other diagrams">
            Add to my macros
          </button>
        )}
      </div>
    </>
  );
};

const ArrangeRow = () => (
  <section>
    <h4>Arrange</h4>
    <div className="seg arrange">
      <button type="button" title="Bring to front (Ctrl+Shift+])" onClick={() => arrangeSelection('front')}>Front</button>
      <button type="button" title="Bring forward (Ctrl+])" onClick={() => arrangeSelection('forward')}>Forward</button>
      <button type="button" title="Send backward (Ctrl+[)" onClick={() => arrangeSelection('backward')}>Backward</button>
      <button type="button" title="Send to back (Ctrl+Shift+[)" onClick={() => arrangeSelection('back')}>Back</button>
    </div>
    <div className="seg arrange make-macro">
      <button type="button" title="Turn the selection into a reusable macro (Ctrl+M)" onClick={makeMacro}>Make macro…</button>
      <button type="button" title="Auto layout leaves locked shapes where they are (Ctrl+L)" onClick={toggleLock}>Lock / unlock</button>
    </div>
  </section>
);

const TextFields = ({ first, patch }: { first: TextShape; patch: Patch<TextShape> }) => (
  <>
    <Row label="Text">
      <input type="text" value={first.text} onChange={(e) => patch((s) => ({ ...s, text: e.target.value }), 'text')} />
    </Row>
    <Row label="Font size">
      <Num value={first.fontSize} min={4} onChange={(fontSize) => patch((s) => ({ ...s, fontSize }), 'text-fs')} />
      <Toggle label="bold" value={first.bold} onChange={(bold) => patch((s) => ({ ...s, bold }))} />
    </Row>
    <Row label="Color">
      <Color value={first.color} onChange={(color) => patch((s) => ({ ...s, color }), 'text-c')} />
    </Row>
    <Row label="Anchor">
      <div className="seg">
        {(['start', 'middle', 'end'] as TextAnchor[]).map((a) => (
          <button key={a} type="button" className={first.anchor === a ? 'on' : ''} onClick={() => patch((s) => ({ ...s, anchor: a }))}>
            {a}
          </button>
        ))}
      </div>
    </Row>
  </>
);

const DotFields = ({ first, patch }: { first: DotShape; patch: Patch<DotShape> }) => (
  <>
    <Row label="Radius">
      <Num value={first.r} step={0.2} min={0.5} onChange={(r) => patch((s) => ({ ...s, r }), 'dot-r')} />
    </Row>
    <Row label="Color">
      <Color value={first.color} onChange={(color) => patch((s) => ({ ...s, color }), 'dot-c')} />
    </Row>
  </>
);

const TITLES: Record<Shape['type'], string> = { box: 'Box', wire: 'Wire', text: 'Label', dot: 'Junction', raw: 'Imported element', macro: 'Macro' };
const MACRO_TITLES: Record<MacroShape['kind'], string> = { mux: 'MUX', alu: 'ALU', reg: 'Register', op: 'Operator', custom: 'Custom macro' };

export const PropsPanel = () => {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const updateShapes = useStore((s) => s.updateShapes);
  const shapes = selection.map((id) => doc.shapes[id]).filter(Boolean);

  if (!shapes.length) {
    return (
      <aside className="props">
        <h3>Properties</h3>
        <p className="muted">Nothing selected. Select a shape to edit its color, line style, arrows and text.</p>
        <p className="muted">Press <kbd>?</kbd> for all shortcuts.</p>
      </aside>
    );
  }

  const byType = new Map<Shape['type'], Shape[]>();
  for (const s of shapes) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);

  return (
    <aside className="props">
      <h3>Properties</h3>
      {[...byType].map(([type, list]) => {
        const ids = list.map((s) => s.id);
        const patch = (fn: (s: never) => Shape, key?: string) => updateShapes(ids, fn as (s: Shape) => Shape, key && `${key}:${ids.join()}`);
        const first = list[0];
        return (
          <section key={type}>
            <h4>
              {first.type === 'macro' && list.every((m) => m.type === 'macro' && m.kind === first.kind) ? MACRO_TITLES[first.kind] : TITLES[type]}
              {list.length > 1 ? ` ×${list.length}` : ''}
            </h4>
            {first.type === 'box' && <BoxFields first={first} patch={patch as Patch<BoxShape>} />}
            {first.type === 'wire' && <WireFields first={first} patch={patch as Patch<WireShape>} />}
            {first.type === 'text' && <TextFields first={first} patch={patch as Patch<TextShape>} />}
            {first.type === 'dot' && <DotFields first={first} patch={patch as Patch<DotShape>} />}
            {first.type === 'macro' && first.kind === 'custom' && <CustomFields first={first} />}
            {first.type === 'macro' && first.kind !== 'custom' && <MacroFields first={first} patch={patch as Patch<MacroShape>} />}
            {first.type === 'raw' && <p className="muted">Kept exactly as it was in the imported file. You can move, copy or delete it.</p>}
          </section>
        );
      })}
      <ArrangeRow />
    </aside>
  );
};
