import { create } from 'zustand';
import { LINE_PRESETS } from './model/presets';
import { emptyDoc, type Doc, type MacroKind, type Shape, type Stroke } from './model/types';
import type { Rect } from './model/geometry';
import { syncConnections, type Edges } from './model/edits';

export type ToolName = 'select' | 'rect' | 'wire' | 'bus' | 'text' | 'move' | 'copy' | 'stretch' | 'place';

/** What the place command drops: a macro kind, or the pipeline-register box preset. */
export type Placeable = MacroKind | 'pipe';

export interface View {
  /** World coordinate shown at the canvas' top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

/** Transient things drawn over the canvas while a tool is active. */
export interface Overlay {
  band?: Rect;
  rectPreview?: Rect;
  wirePreview?: { points: { x: number; y: number }[] };
  hover?: { kind: 'box'; id: string; edges: Edges } | { kind: 'wire'; id: string; points: number[] } | { kind: 'shape'; id: string };
  /** Shape following the cursor in the place command. */
  ghost?: Shape;
  /** Port the wire tool will snap to. */
  port?: { x: number; y: number };
}

export interface TextEdit {
  id: string;
  /** Shape created just for this edit; dropped if left empty. */
  isNew: boolean;
}

const HISTORY_LIMIT = 200;

interface State {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  /** Coalesces rapid edits (e.g. dragging a color picker) into one undo step. */
  lastCommitKey: { key: string; at: number } | null;
  preview: Doc | null;
  selection: string[];
  tool: ToolName;
  view: View;
  canvasSize: { w: number; h: number };
  overlay: Overlay;
  prompt: string;
  wireStroke: Stroke;
  busWidth: number;
  gridVisible: boolean;
  snapOn: boolean;
  textEdit: TextEdit | null;
  placing: Placeable;
  muxInputs: number;
  showMacroPicker: boolean;
  showHelp: boolean;
  showProps: boolean;
  fileName: string;
  dirty: boolean;
  toast: string | null;
  /** Last pointer position in world coordinates, for the status bar. */
  cursor: { x: number; y: number };

  commit: (doc: Doc, opts?: { select?: string[]; key?: string }) => void;
  setPreview: (doc: Doc | null) => void;
  undo: () => void;
  redo: () => void;
  setSelection: (ids: string[]) => void;
  setTool: (tool: ToolName) => void;
  setView: (view: View) => void;
  setOverlay: (overlay: Overlay) => void;
  setPrompt: (prompt: string) => void;
  updateShapes: (ids: string[], patch: (s: Shape) => Shape, key?: string) => void;
  loadDoc: (doc: Doc, fileName: string) => void;
  notify: (msg: string) => void;
  set: (partial: Partial<State>) => void;
}

export const TOOL_PROMPTS: Record<ToolName, string> = {
  select: 'Click to select, drag to move or box-select. Double-click a box or text to edit it.',
  rect: 'Rectangle: click or drag to set the first corner, then the opposite corner.',
  wire: 'Wire: click to add points, Space flips the bend, double-click / Enter / right-click to finish.',
  bus: 'Bus: like a wire, tagged with the bus width from the options bar.',
  text: 'Label: click where the text should start.',
  move: 'Move: click a reference point, then the destination. Hold Shift to lock the axis.',
  copy: 'Copy: click a reference point, then the destination. Hold Shift to lock the axis.',
  stretch: 'Stretch: click an edge, corner, vertex or segment, or drag a box around the edges to stretch.',
  place: 'Place: click to drop the macro (top-left corner at the cursor). Esc to stop.',
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  lastCommitKey: null,
  preview: null,
  selection: [],
  tool: 'select',
  view: { x: -40, y: -40, zoom: 1 },
  canvasSize: { w: 800, h: 600 },
  overlay: {},
  prompt: TOOL_PROMPTS.select,
  wireStroke: { ...LINE_PRESETS[0].stroke },
  busWidth: 32,
  gridVisible: true,
  snapOn: true,
  textEdit: null,
  placing: 'mux',
  muxInputs: 2,
  showMacroPicker: false,
  showHelp: false,
  showProps: true,
  fileName: 'diagram.svg',
  dirty: false,
  toast: null,
  cursor: { x: 0, y: 0 },

  commit: (doc, opts) => {
    const { doc: prev, past, lastCommitKey } = get();
    const now = Date.now();
    const coalesce = opts?.key && lastCommitKey?.key === opts.key && now - lastCommitKey.at < 1500;
    set({
      doc,
      past: coalesce ? past : [...past, prev].slice(-HISTORY_LIMIT),
      future: [],
      preview: null,
      dirty: true,
      lastCommitKey: opts?.key ? { key: opts.key, at: now } : null,
      ...(opts?.select ? { selection: opts.select } : {}),
    });
  },
  setPreview: (preview) => set({ preview }),
  undo: () => {
    const { past, doc, future, selection } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future],
      preview: null,
      lastCommitKey: null,
      selection: selection.filter((id) => prev.shapes[id]),
      dirty: true,
    });
  },
  redo: () => {
    const { past, doc, future, selection } = get();
    if (!future.length) return;
    const next = future[0];
    set({
      doc: next,
      past: [...past, doc],
      future: future.slice(1),
      preview: null,
      lastCommitKey: null,
      selection: selection.filter((id) => next.shapes[id]),
      dirty: true,
    });
  },
  setSelection: (selection) => set({ selection }),
  setTool: (tool) => set({ tool, prompt: TOOL_PROMPTS[tool], overlay: {}, preview: null }),
  setView: (view) => set({ view }),
  setOverlay: (overlay) => set({ overlay }),
  setPrompt: (prompt) => set({ prompt }),
  updateShapes: (ids, patch, key) => {
    const { doc, commit } = get();
    const shapes = { ...doc.shapes };
    let changed = false;
    for (const id of ids) {
      const s = shapes[id];
      if (!s) continue;
      const next = patch(s);
      if (next !== s) {
        shapes[id] = next;
        changed = true;
      }
    }
    // Attached wires follow edits such as a MUX gaining inputs.
    if (changed) commit(syncConnections({ ...doc, shapes }), { key });
  },
  loadDoc: (doc, fileName) =>
    set({ doc, past: [], future: [], preview: null, selection: [], fileName, dirty: false, lastCommitKey: null }),
  notify: (msg) => {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 2500);
  },
  set: (partial) => set(partial),
}));

/** Doc currently on screen: the live preview during a drag, otherwise the committed doc. */
export const useVisibleDoc = (): Doc => useStore((s) => s.preview ?? s.doc);
