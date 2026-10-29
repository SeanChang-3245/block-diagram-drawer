import { useStore, type Placeable } from '../store';
import { LINE_PRESETS } from '../model/presets';
import { arrange, duplicate, expandGroups, syncConnections, type Arrange } from '../model/edits';
import { newId, type CustomDef, type Direction, type Doc } from '../model/types';
import { explodeCustom, makeCustomMacro } from '../model/custom';
import { libraryFile, parseLibraryFile, saveLibrary } from '../io/library';
import { armTool, enter, escape, isBusy, space, startZoomBox } from '../tools/interaction';
import { exportPdfFile, exportPngFile, newFile, openFile, saveFile } from '../io/files';
import { fitView, panBy, zoomBy } from './viewOps';

const st = () => useStore.getState();

export const deleteSelection = () => {
  const { doc, selection, commit } = st();
  const ids = new Set(expandGroups(doc, selection));
  if (!ids.size) return;
  const shapes = { ...doc.shapes };
  for (const id of ids) delete shapes[id];
  commit({ shapes, order: doc.order.filter((id) => !ids.has(id)) }, { select: [] });
};

export const group = () => {
  const { doc, selection, commit, notify } = st();
  if (selection.length < 2) return notify('Select two or more shapes to group.');
  const g = newId('g');
  const shapes = { ...doc.shapes };
  for (const id of expandGroups(doc, selection)) shapes[id] = { ...shapes[id], groupId: g };
  commit({ ...doc, shapes });
  notify('Grouped');
};

export const ungroup = () => {
  const { doc, selection, commit, notify } = st();
  const shapes = { ...doc.shapes };
  for (const id of selection) {
    const { groupId: _drop, ...rest } = shapes[id];
    shapes[id] = rest as typeof shapes[string];
  }
  commit({ ...doc, shapes });
  notify('Ungrouped');
};

/** Keys 1-3: set the style for new wires and, outside drawing commands, restyle the selection. */
export const applyPreset = (index: number) => {
  const preset = LINE_PRESETS[index];
  if (!preset) return;
  const { selection, updateShapes, set, notify, tool } = st();
  set({ wireStroke: { ...preset.stroke } });
  // While drawing, the keys only pick the style for the next wire.
  if (tool === 'wire' || tool === 'bus') return notify(`Next wires: ${preset.name}`);
  updateShapes(selection, (s) =>
    s.type === 'wire' ? { ...s, stroke: { ...preset.stroke } } : s.type === 'box' ? { ...s, stroke: { ...s.stroke, color: preset.stroke.color, dash: preset.stroke.dash } } : s,
  );
  notify(`Line style: ${preset.name}`);
};

let clipboard: Doc | null = null;

export const copyToClipboard = () => {
  const { doc, selection } = st();
  const ids = expandGroups(doc, selection);
  if (!ids.length) return;
  clipboard = { shapes: Object.fromEntries(ids.map((id) => [id, doc.shapes[id]])), order: ids };
  st().notify(`Copied ${ids.length} shape(s)`);
};

export const paste = () => {
  if (!clipboard) return;
  const { doc, commit } = st();
  const dup = duplicate(clipboard, clipboard.order, 20, 20);
  const shapes = { ...doc.shapes };
  for (const id of dup.ids) shapes[id] = dup.doc.shapes[id];
  commit({ shapes, order: [...doc.order, ...dup.ids] }, { select: dup.ids });
  // Paste again lands one step further.
  clipboard = { shapes: Object.fromEntries(dup.ids.map((id) => [id, dup.doc.shapes[id]])), order: dup.ids };
};

export const openMacroPicker = () => st().set({ showMacroPicker: true });

export const choosePlaceable = (kind: Placeable) => {
  st().set({ placing: kind, showMacroPicker: false });
  armTool('place');
};

export const arrangeSelection = (how: Arrange) => {
  const { doc, selection, commit, notify } = st();
  const ids = expandGroups(doc, selection);
  if (!ids.length) return notify('Select something to re-order.');
  const next = arrange(doc, ids, how);
  if (next.order.every((id, i) => id === doc.order[i])) return notify(how === 'front' || how === 'forward' ? 'Already in front' : 'Already at the back');
  commit(next);
};

const CLOCKWISE: Record<Direction, Direction> = { right: 'down', down: 'left', left: 'up', up: 'right' };

/** Turn selected macros a quarter turn clockwise about their centre. */
export const rotateSelection = () => {
  const { doc, selection, commit, notify } = st();
  const shapes = { ...doc.shapes };
  let n = 0;
  for (const id of selection) {
    const m = shapes[id];
    if (m?.type !== 'macro' || m.kind === 'custom') continue;
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    shapes[id] = { ...m, dir: CLOCKWISE[m.dir], w: m.h, h: m.w, x: Math.round(cx - m.h / 2), y: Math.round(cy - m.w / 2) };
    n++;
  }
  if (!n) return notify('Select a macro to rotate.');
  commit(syncConnections({ ...doc, shapes }));
};

const setLibrary = (library: CustomDef[]) => {
  st().set({ library });
  if (!saveLibrary(library)) st().notify('Could not save the macro library in this browser.');
};

export const addToLibrary = (def: CustomDef) => {
  const { library } = st();
  setLibrary([...library.filter((d) => d.id !== def.id), def]);
};

export const removeFromLibrary = (id: string) => {
  const def = st().library.find((d) => d.id === id);
  if (def && !confirm(`Remove "${def.name}" from your macros? Diagrams that use it keep their copy.`)) return;
  setLibrary(st().library.filter((d) => d.id !== id));
};

/** Ctrl+M: turn the selection into a custom macro, placed where the shapes were and added to the library. */
export const makeMacro = () => {
  const { doc, selection, commit, notify } = st();
  if (!selection.length) return notify('Select the shapes that make up the macro first.');
  const name = prompt('Name of the new macro:', 'Macro');
  if (name === null) return;
  const r = makeCustomMacro(doc, selection, name);
  if (!r.ok) return notify(r.error);
  commit(r.doc, { select: [r.instance.id] });
  addToLibrary(r.def);
  notify(
    r.def.ports.length
      ? `Macro "${r.def.name}" created with pins ${r.def.ports.map((p) => p.name).join(', ')}`
      : `Macro "${r.def.name}" created without pins. Add wire stubs ending in empty space to give it pins.`,
  );
};

export const explodeSelection = () => {
  const { doc, selection, commit } = st();
  let next = doc;
  const ids: string[] = [];
  for (const id of selection) {
    const r = explodeCustom(next, id);
    next = r.doc;
    ids.push(...r.ids);
  }
  if (next !== doc) commit(next, { select: ids });
};

export const exportLibrary = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(libraryFile(st().library));
  a.download = 'macros.bdd.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export const importLibrary = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const incoming = parseLibraryFile(await file.text());
      const ids = new Set(incoming.map((d) => d.id));
      setLibrary([...st().library.filter((d) => !ids.has(d.id)), ...incoming]);
      st().notify(`Added ${incoming.length} macro(s)`);
    } catch (e) {
      st().notify(`Could not read ${file.name}: ${(e as Error).message}`);
    }
  };
  input.click();
};

/** Keys while the macro picker is open. */
const pickerKey = (e: KeyboardEvent) => {
  e.preventDefault();
  if (e.key === 'Escape') return st().set({ showMacroPicker: false });
  if (/^[2-9]$/.test(e.key)) return st().set({ muxInputs: Number(e.key) });
  const keys: Record<string, Placeable> = { m: 'mux', a: 'alu', r: 'reg', o: 'op', p: 'pipe' };
  const kind = keys[e.key.toLowerCase()];
  if (kind) choosePlaceable(kind);
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export const onKeyDown = (e: KeyboardEvent) => {
  if (isTyping(e.target) || st().textEdit) return;
  if (st().showMacroPicker) return pickerKey(e);
  if (st().showAiPrompt || st().showHelp) {
    if (e.key === 'Escape' || (e.key === '?' && st().showHelp)) st().set({ showAiPrompt: false, showHelp: false });
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const lower = k.toLowerCase();

  if (mod) {
    const handled = (() => {
      switch (lower) {
        case 's': return void saveFile(e.shiftKey), true;
        case 'o': return void openFile(), true;
        case 'z': return (e.shiftKey ? st().redo() : st().undo()), true;
        case 'y': return st().redo(), true;
        case 'a': return st().setSelection([...st().doc.order]), true;
        case 'g': return (e.shiftKey ? ungroup() : group()), true;
        case 'c': return copyToClipboard(), true;
        case 'v': return paste(), true;
        case 'e': return void exportPngFile(), true;
        case 'p': return void exportPdfFile(), true;
        case 'm': return makeMacro(), true;
        case ']': case '}': return arrangeSelection(e.shiftKey ? 'front' : 'forward'), true;
        case '[': case '{': return arrangeSelection(e.shiftKey ? 'back' : 'backward'), true;
        default: return false;
      }
    })();
    if (handled) e.preventDefault();
    return;
  }
  if (e.altKey) return;

  const tools: Record<string, Parameters<typeof armTool>[0]> = {
    r: 'rect', w: 'wire', b: 'bus', l: 'text', m: 'move', c: 'copy', s: 'stretch',
  };
  if (!e.shiftKey && tools[k]) {
    e.preventDefault();
    return armTool(tools[k]);
  }

  switch (k) {
    case 'Escape': return escape();
    case 'Enter': return enter();
    case ' ':
      if (space()) e.preventDefault();
      return;
    case 'Delete':
    case 'Backspace':
      if (!isBusy()) deleteSelection();
      e.preventDefault();
      return;
    case 'u': return st().undo();
    case 'U': return st().redo();
    case 'z': return startZoomBox();
    case 'Z': return zoomBy(1 / 2);
    case 'f': return fitView();
    case 'q': return st().set({ showProps: !st().showProps });
    case 'g': return st().set({ gridVisible: !st().gridVisible });
    case 'i': return openMacroPicker();
    case 'R': return rotateSelection();
    case '?': return st().set({ showHelp: !st().showHelp });
    case '1': case '2': case '3': return applyPreset(Number(k) - 1);
    case 'ArrowLeft': return panBy(-60, 0);
    case 'ArrowRight': return panBy(60, 0);
    case 'ArrowUp': return panBy(0, -60);
    case 'ArrowDown': return panBy(0, 60);
  }
};

export { newFile, openFile, saveFile, exportPngFile, exportPdfFile };
