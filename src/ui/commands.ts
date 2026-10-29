import { useStore } from '../store';
import { LINE_PRESETS } from '../model/presets';
import { duplicate, expandGroups } from '../model/edits';
import { newId, type Doc } from '../model/types';
import { armTool, enter, escape, isBusy, space } from '../tools/interaction';
import { exportPngFile, newFile, openFile, saveFile } from '../io/files';
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

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export const onKeyDown = (e: KeyboardEvent) => {
  if (isTyping(e.target) || st().textEdit) return;
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
    case 'z': return zoomBy(1.25);
    case 'Z': return zoomBy(1 / 1.25);
    case 'f': return fitView();
    case 'q': return st().set({ showProps: !st().showProps });
    case 'g': return st().set({ gridVisible: !st().gridVisible });
    case 'i': return st().notify('Macros (MUX, ALU, register…) arrive in the next milestone.');
    case '?': return st().set({ showHelp: !st().showHelp });
    case '1': case '2': case '3': return applyPreset(Number(k) - 1);
    case 'ArrowLeft': return panBy(-60, 0);
    case 'ArrowRight': return panBy(60, 0);
    case 'ArrowUp': return panBy(0, -60);
    case 'ArrowDown': return panBy(0, 60);
  }
};

export { newFile, openFile, saveFile, exportPngFile };
