// Toolbars, status bar and the shortcut sheet around the canvas.

import { useStore, type Placeable, type ToolName } from '../store';
import { LINE_PRESETS } from '../model/presets';
import { MACRO_TEMPLATES } from '../model/macros';
import { armTool, makePlaceable } from '../tools/interaction';
import { ShapeView } from '../render/ShapeView';
import { applyPreset, choosePlaceable, exportLibrary, toggleAutoRoute, exportPdfFile, exportPngFile, importLibrary, newFile, openFile, openMacroPicker, removeFromLibrary, saveFile } from './commands';
import { AI_PROMPT } from '../io/aiFormat';
import { fitView } from './viewOps';

const ICONS: Record<ToolName, JSX.Element> = {
  select: <path d="M5 3 L5 17 L9 13 L12 19 L14 18 L11 12 L16 12 Z" fill="currentColor" />,
  rect: <rect x="3" y="5" width="16" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  wire: <path d="M2 16 H10 V6 H17" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  bus: (
    <>
      <path d="M2 11 H20" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 15 L14 7" stroke="currentColor" strokeWidth="1.5" />
      <text x="15" y="7" fontSize="7" fill="currentColor">n</text>
    </>
  ),
  text: <text x="4" y="17" fontSize="15" fontWeight="bold" fill="currentColor">T</text>,
  move: <path d="M11 2 V20 M2 11 H20 M11 2 L8 5 M11 2 L14 5 M11 20 L8 17 M11 20 L14 17 M2 11 L5 8 M2 11 L5 14 M20 11 L17 8 M20 11 L17 14" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  copy: (
    <>
      <rect x="3" y="3" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="8" y="8" width="11" height="11" fill="var(--panel)" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
  place: <path d="M6 3 L16 7 L16 15 L6 19 Z" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  stretch: (
    <>
      <rect x="3" y="6" width="9" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" />
      <path d="M12 6 V16" stroke="currentColor" strokeWidth="2.4" />
      <path d="M14 11 H20 M20 11 L17 8 M20 11 L17 14" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </>
  ),
};

const TOOLS: { tool: ToolName; key: string; label: string }[] = [
  { tool: 'select', key: 'Esc', label: 'Select' },
  { tool: 'rect', key: 'R', label: 'Rectangle' },
  { tool: 'wire', key: 'W', label: 'Wire' },
  { tool: 'bus', key: 'B', label: 'Bus' },
  { tool: 'text', key: 'L', label: 'Label' },
  { tool: 'place', key: 'I', label: 'Macro (MUX, ALU, register, ...)' },
  { tool: 'move', key: 'M', label: 'Move' },
  { tool: 'copy', key: 'C', label: 'Copy' },
  { tool: 'stretch', key: 'S', label: 'Stretch' },
];

export const ToolPalette = () => {
  const tool = useStore((s) => s.tool);
  return (
    <nav className="palette" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className={tool === t.tool ? 'on' : ''}
          title={`${t.label} (${t.key})`}
          onClick={() => (t.tool === 'place' ? openMacroPicker() : armTool(t.tool))}
        >
          <svg width="22" height="22" viewBox="0 0 22 22">{ICONS[t.tool]}</svg>
          <span className="key">{t.key}</span>
        </button>
      ))}
    </nav>
  );
};

export const TopBar = () => {
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const gridVisible = useStore((s) => s.gridVisible);
  const snapOn = useStore((s) => s.snapOn);
  const set = useStore((s) => s.set);
  return (
    <header className="topbar">
      <strong className="brand">Block Diagram Drawer</strong>
      <span className="file" title={fileName}>
        {fileName}
        {dirty ? ' •' : ''}
      </span>
      <div className="group">
        <button type="button" onClick={newFile}>New</button>
        <button type="button" onClick={() => void openFile()} title="Open an SVG (Ctrl+O). Any SVG works: AI-drawn ones are converted to editable shapes.">Open</button>
        <button type="button" onClick={() => void saveFile()} title="Save SVG (Ctrl+S)">Save</button>
        <button type="button" onClick={() => void saveFile(true)} title="Save as (Ctrl+Shift+S)">Save as</button>
        <button type="button" onClick={() => void exportPngFile()} title="Export PNG (Ctrl+E)">PNG</button>
        <button type="button" onClick={() => void exportPdfFile()} title="Export vector PDF (Ctrl+P)">PDF</button>
      </div>
      <div className="group">
        <button type="button" disabled={!canUndo} onClick={() => useStore.getState().undo()} title="Undo (U)">Undo</button>
        <button type="button" disabled={!canRedo} onClick={() => useStore.getState().redo()} title="Redo (Shift+U)">Redo</button>
      </div>
      <div className="group">
        <label className="inline"><input type="checkbox" checked={gridVisible} onChange={(e) => set({ gridVisible: e.target.checked })} /> Grid</label>
        <label className="inline"><input type="checkbox" checked={snapOn} onChange={(e) => set({ snapOn: e.target.checked })} /> Snap</label>
        <button type="button" onClick={fitView} title="Fit (F)">Fit</button>
      </div>
      <div className="spacer" />
      <button type="button" onClick={() => set({ showAiPrompt: true })} title="Get a prompt that makes an AI draw editable diagrams">AI prompt</button>
      <button type="button" onClick={() => set({ showHelp: true })} title="Shortcuts (?)">Shortcuts ?</button>
    </header>
  );
};

/** Bottom bar: command prompt (layout-editor style), command options, cursor and zoom. */
export const StatusBar = () => {
  const prompt = useStore((s) => s.prompt);
  const tool = useStore((s) => s.tool);
  const cursor = useStore((s) => s.cursor);
  const zoom = useStore((s) => s.view.zoom);
  const busWidth = useStore((s) => s.busWidth);
  const wireStroke = useStore((s) => s.wireStroke);
  const selCount = useStore((s) => s.selection.length);
  const set = useStore((s) => s.set);
  const showWireOpts = tool === 'wire' || tool === 'bus';
  const placing = useStore((s) => s.placing);
  const muxInputs = useStore((s) => s.muxInputs);
  const library = useStore((s) => s.library);
  const autoRoute = useStore((s) => s.autoRoute);
  return (
    <footer className="status">
      <span className="mode">{tool.toUpperCase()}</span>
      <span className="prompt">{prompt}</span>
      {showWireOpts && (
        <span className="opts">
          Style
          {LINE_PRESETS.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className={wireStroke.color === p.stroke.color && wireStroke.dash === p.stroke.dash ? 'on' : ''}
              onClick={() => applyPreset(i)}
              title={`${p.name} (${p.key})`}
            >
              {p.key} {p.name}
            </button>
          ))}
          {tool === 'bus' && (
            <label className="inline">
              Width
              <input type="number" min={2} value={busWidth} onChange={(e) => set({ busWidth: Math.max(2, Math.round(Number(e.target.value) || 2)) })} />
            </label>
          )}
        </span>
      )}
      {tool === 'place' && (
        <span className="opts">
          {PLACEABLES.find((p) => p.kind === placing)?.name ?? library.find((d) => `custom:${d.id}` === placing)?.name}
          {placing === 'mux' && (
            <label className="inline">
              Inputs
              <input type="number" min={2} value={muxInputs} onChange={(e) => set({ muxInputs: Math.max(2, Math.round(Number(e.target.value) || 2)) })} />
            </label>
          )}
          <button type="button" onClick={openMacroPicker}>Change (I)</button>
        </span>
      )}
      <span className="spacer" />
      <button type="button" className={`route-toggle ${autoRoute ? 'on' : ''}`} onClick={toggleAutoRoute} title="Route wires around blocks automatically (Shift+W with nothing selected)">
        Auto-route {autoRoute ? 'on' : 'off'}
      </button>
      {selCount > 0 && <span>{selCount} selected</span>}
      <span className="coords">
        x {Math.round(cursor.x)} y {Math.round(cursor.y)}
      </span>
      <span>{Math.round(zoom * 100)}%</span>
    </footer>
  );
};

const SHORTCUTS: [string, string][][] = [
  [
    ['R', 'Rectangle box'],
    ['W', 'Wire'],
    ['B', 'Bus (wire + width mark)'],
    ['L', 'Text label'],
    ['I', 'Place macro (MUX, ALU, register, ...)'],
    ['M', 'Move'],
    ['C', 'Copy'],
    ['S', 'Stretch edges / vertices'],
    ['Esc', 'Cancel step / exit command'],
    ['Del', 'Delete selection'],
  ],
  [
    ['Q', 'Toggle properties panel'],
    ['F', 'Fit diagram to window'],
    ['Z', 'Zoom into an area (drag or click 2 corners)'],
    ['Shift+Z', 'Zoom out 2×'],
    ['U / Shift+U', 'Undo / redo'],
    ['1 2 3', 'Line style: datapath / control / exception'],
    ['G', 'Toggle grid'],
    ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
    ['Ctrl+M', 'Make a custom macro from the selection'],
    ['Ctrl+S / Ctrl+O', 'Save / open SVG'],
    ['Ctrl+C / Ctrl+V', 'Copy / paste'],
    ['Ctrl+E / Ctrl+P', 'Export PNG / PDF'],
    ['Ctrl+] / Ctrl+[', 'Bring forward / send backward'],
    ['Ctrl+Shift+] / [', 'Bring to front / send to back'],
  ],
  [
    ['Shift+W', 'Re-route selected wires / toggle auto-route'],
    ['A then ← → ↑ ↓ / H / V / D', 'Align to first selected / distribute'],
    ['Shift+S', 'Straighten small wire jogs'],
    ['Space', 'While drawing: use a simple bend (flip it)'],
    ['Enter / dbl-click / right-click', 'Finish wire'],
    ['Shift (move/copy/stretch)', 'Lock to one axis'],
    ['Shift+click', 'Add to / remove from selection'],
    ['Wheel', 'Zoom at cursor'],
    ['Middle-drag / arrows', 'Pan'],
    ['Double-click box', 'Edit text (Ctrl+Enter to finish)'],
    ['Drag a wire label', 'Slide it along the wire'],
    ['Shift+R', 'Rotate selected macros 90°'],
  ],
];

export const HelpOverlay = () => {
  const show = useStore((s) => s.showHelp);
  const set = useStore((s) => s.set);
  if (!show) return null;
  return (
    <div className="help-backdrop" onClick={() => set({ showHelp: false })}>
      <div className="help" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="help-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" onClick={() => set({ showHelp: false })}>Close</button>
        </div>
        <div className="help-cols">
          {SHORTCUTS.map((col, i) => (
            <table key={i}>
              <tbody>
                {col.map(([k, d]) => (
                  <tr key={k}>
                    <td><kbd>{k}</kbd></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <p className="muted">
          Stretch works like a layout editor: press <kbd>S</kbd>, then click a box edge (or corner) to resize, a wire segment to slide it, or a
          vertex to move it. Drag a box instead to grab every edge and vertex inside it. Wires whose ends sit on a moving edge follow it.
        </p>
      </div>
    </div>
  );
};

export const Toast = () => {
  const toast = useStore((s) => s.toast);
  return toast ? <div className="toast">{toast}</div> : null;
};

export const PLACEABLES: { kind: Placeable; key: string; name: string }[] = [
  ...MACRO_TEMPLATES.map((t) => ({ kind: t.kind, key: t.key, name: t.name })),
  { kind: 'pipe', key: 'p', name: 'Pipeline register' },
];

const PickerItem = ({ kind, label, hotkey, onRemove }: { kind: Placeable; label: string; hotkey?: string; onRemove?: () => void }) => {
  const placing = useStore((s) => s.placing);
  const muxInputs = useStore((s) => s.muxInputs);
  const made = makePlaceable(kind, { x: 0, y: 0 }, kind === 'mux' ? muxInputs : 2);
  // The real pipeline register is very tall; preview a short one.
  const shape = made.type === 'box' ? { ...made, h: Math.min(made.h, 60) } : made;
  const b = shape.type === 'box' || shape.type === 'macro' ? { w: shape.w, h: shape.h } : { w: 40, h: 40 };
  const pad = 8;
  const size = Math.max(b.w, b.h) + 2 * pad;
  return (
    <div className="picker-item">
      <button type="button" className={placing === kind ? 'on' : ''} onClick={() => choosePlaceable(kind)}>
        <svg width="64" height="64" viewBox={`${-pad} ${-pad} ${size} ${size}`} fontFamily="Helvetica, Arial, sans-serif">
          <ShapeView s={shape} />
        </svg>
        <span>
          {hotkey && <kbd>{hotkey.toUpperCase()}</kbd>} {label}
        </span>
      </button>
      {onRemove && (
        <button type="button" className="remove" title="Remove from library" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
};

/** Picker opened by I: one key per macro, like a layout editor's instance form; library macros below. */
export const MacroPicker = () => {
  const show = useStore((s) => s.showMacroPicker);
  const muxInputs = useStore((s) => s.muxInputs);
  const library = useStore((s) => s.library);
  const set = useStore((s) => s.set);
  if (!show) return null;
  return (
    <div className="help-backdrop" onClick={() => set({ showMacroPicker: false })}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Place macro">
        <div className="help-head">
          <h2>Place macro</h2>
          <span className="muted">press a key, or click</span>
        </div>
        <div className="picker-grid">
          {PLACEABLES.map((p) => (
            <PickerItem key={p.kind} kind={p.kind} label={p.name} hotkey={p.key} />
          ))}
        </div>
        <label className="inline picker-opt">
          MUX inputs
          <input
            type="number"
            min={2}
            value={muxInputs}
            onChange={(e) => set({ muxInputs: Math.max(2, Math.round(Number(e.target.value) || 2)) })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <span className="muted">any number, not just powers of two; type digits here or press 2-9</span>
        </label>
        <div className="help-head picker-lib-head">
          <h3>My macros</h3>
          <span className="group">
            <button type="button" onClick={() => void importLibrary()} title="Add macros from a library file">Import…</button>
            <button type="button" onClick={exportLibrary} disabled={!library.length} title="Save the library to a file">Export</button>
          </span>
        </div>
        {library.length ? (
          <div className="picker-grid">
            {library.map((d) => (
              <PickerItem key={d.id} kind={`custom:${d.id}`} label={d.name} onRemove={() => removeFromLibrary(d.id)} />
            ))}
          </div>
        ) : (
          <p className="muted small">
            None yet. Select some shapes and press <kbd>Ctrl+M</kbd> to make one. Short wire stubs whose ends touch nothing become its pins,
            named after their labels.
          </p>
        )}
      </div>
    </div>
  );
};

/** The format description to paste into an AI chat. */
export const AiPromptDialog = () => {
  const show = useStore((s) => s.showAiPrompt);
  const set = useStore((s) => s.set);
  if (!show) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      useStore.getState().notify('Prompt copied. Paste it into your AI chat, followed by what to draw.');
    } catch {
      useStore.getState().notify('Copy failed: select the text and copy it by hand.');
    }
  };
  return (
    <div className="help-backdrop" onClick={() => set({ showAiPrompt: false })}>
      <div className="help ai" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI drawing prompt">
        <div className="help-head">
          <h2>Let an AI draw it</h2>
          <span className="group">
            <button type="button" onClick={() => void copy()}>Copy prompt</button>
            <button type="button" onClick={() => set({ showAiPrompt: false })}>Close</button>
          </span>
        </div>
        <p className="muted">
          Paste this prompt into any AI chat, then describe the circuit. Open the SVG it returns here: every box, macro and wire will be editable,
          with wires already attached to pins. Plain SVGs from AIs that ignore the format still import, with shapes recognised by their look.
        </p>
        <textarea className="ai-prompt" readOnly value={AI_PROMPT} onKeyDown={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
};
