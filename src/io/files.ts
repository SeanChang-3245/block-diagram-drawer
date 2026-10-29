// Open / save through the File System Access API when the browser has it
// (so Ctrl+S overwrites the same file), falling back to upload / download.

import { useStore } from '../store';
import { exportPdf, exportPng, exportSvg } from './exportSvg';
import { importSvg } from './importSvg';
import { fitView } from '../ui/viewOps';

interface FileHandleLike {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: Blob | string) => Promise<void>; close: () => Promise<void> }>;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandleLike>;
};

const SVG_TYPES = [{ description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } }];

let handle: FileHandleLike | null = null;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const loadSvgText = (text: string, name: string) => {
  const s = useStore.getState();
  try {
    const { doc, native, stats, recognized: r } = importSvg(text);
    s.loadDoc(doc, name);
    fitView();
    if (native) s.notify(`Opened ${name}`);
    else {
      const found = [
        !r && stats.macro && `${stats.macro} macros`,
        r?.mux && `${r.mux} MUX`,
        r?.alu && `${r.alu} ALU`,
        r?.op && `${r.op} operator`,
        stats.box && `${stats.box} boxes`,
        stats.wire && `${stats.wire} wires`,
        r?.labels && `${r.labels} wire labels`,
        stats.raw && `${stats.raw} kept as-is`,
      ].filter(Boolean);
      s.notify(`Imported ${name}: ${found.join(', ') || 'nothing recognised'}`);
    }
  } catch (e) {
    s.notify(`Could not open ${name}: ${(e as Error).message}`);
  }
};

export const openFile = async () => {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: SVG_TYPES });
      const file = await h.getFile();
      handle = h;
      loadSvgText(await file.text(), file.name);
    } catch (e) {
      if (!isAbort(e)) useStore.getState().notify(`Open failed: ${(e as Error).message}`);
    }
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.svg,image/svg+xml';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    handle = null;
    loadSvgText(await file.text(), file.name);
  };
  input.click();
};

export const openDroppedFile = async (file: File) => {
  handle = null;
  loadSvgText(await file.text(), file.name);
};

export const saveFile = async (saveAs = false) => {
  const s = useStore.getState();
  const svg = exportSvg(s.doc);
  const w = window as PickerWindow;
  try {
    if (handle && !saveAs) {
      const out = await handle.createWritable();
      await out.write(svg);
      await out.close();
    } else if (w.showSaveFilePicker) {
      handle = await w.showSaveFilePicker({ suggestedName: s.fileName, types: SVG_TYPES });
      const out = await handle.createWritable();
      await out.write(svg);
      await out.close();
      s.set({ fileName: handle.name });
    } else {
      download(new Blob([svg], { type: 'image/svg+xml' }), s.fileName);
    }
    useStore.getState().set({ dirty: false });
    useStore.getState().notify(`Saved ${useStore.getState().fileName}`);
  } catch (e) {
    if (!isAbort(e)) s.notify(`Save failed: ${(e as Error).message}`);
  }
};

export const exportPngFile = async () => {
  const s = useStore.getState();
  try {
    const blob = await exportPng(s.doc);
    download(blob, s.fileName.replace(/\.svg$/i, '') + '.png');
  } catch (e) {
    s.notify(`PNG export failed: ${(e as Error).message}`);
  }
};

export const exportPdfFile = async () => {
  const s = useStore.getState();
  s.notify('Creating PDF…');
  try {
    const blob = await exportPdf(s.doc);
    download(blob, s.fileName.replace(/\.svg$/i, '') + '.pdf');
    s.notify('PDF exported');
  } catch (e) {
    s.notify(`PDF export failed: ${(e as Error).message}`);
  }
};

export const newFile = () => {
  const s = useStore.getState();
  if (s.dirty && s.doc.order.length && !confirm('Discard unsaved changes?')) return;
  handle = null;
  s.loadDoc({ shapes: {}, order: [] }, 'diagram.svg');
  s.setView({ x: -40, y: -40, zoom: 1 });
};

const AUTOSAVE_KEY = 'bdd-autosave';

/** Keep a crash-recovery copy in this browser. */
export const startAutosave = () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((state, prev) => {
    if (state.doc === prev.doc) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ doc: state.doc, fileName: state.fileName }));
      } catch {
        // storage unavailable or full: autosave is best effort
      }
    }, 500);
  });
};

export const restoreAutosave = () => {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    const { doc, fileName } = JSON.parse(raw);
    if (doc?.order?.length) {
      useStore.getState().loadDoc(doc, fileName ?? 'diagram.svg');
      fitView();
    }
  } catch {
    // ignore a corrupt or inaccessible autosave
  }
};
