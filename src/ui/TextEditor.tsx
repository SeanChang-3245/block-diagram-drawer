import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { textBounds } from '../model/geometry';

/** In-place editor for a box label or a text label. */
export const TextEditor = () => {
  const edit = useStore((s) => s.textEdit);
  const shape = useStore((s) => (s.textEdit ? s.doc.shapes[s.textEdit.id] : undefined));
  const view = useStore((s) => s.view);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const closed = useRef(false);

  const editable = shape && (shape.type === 'box' || shape.type === 'text') ? shape : null;

  useEffect(() => {
    if (!editable) return;
    setValue(editable.text);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    closed.current = false;
    // Only reset when a new edit session starts.
  }, [edit]);

  if (!edit || !editable) return null;

  const close = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    const s = useStore.getState();
    const text = save ? value : editable.text;
    if (edit.isNew && !text.trim()) {
      // Abandoned new label: drop it without leaving an undo step behind.
      const prev = s.past[s.past.length - 1];
      s.set({ doc: prev ?? s.doc, past: s.past.slice(0, -1), selection: [], textEdit: null });
      return;
    }
    s.set({ textEdit: null });
    if (save && text !== editable.text) s.updateShapes([editable.id], (sh) => ({ ...sh, text }) as typeof sh);
  };

  const z = view.zoom;
  const sx = (x: number) => (x - view.x) * z;
  const sy = (y: number) => (y - view.y) * z;
  let style: React.CSSProperties;
  if (editable.type === 'box') {
    style = {
      left: sx(editable.x),
      top: sy(editable.y),
      width: editable.w * z,
      height: editable.h * z,
      fontSize: editable.fontSize * z,
      textAlign: 'center',
      paddingTop: Math.max(0, (editable.h * z) / 2 - ((value.split('\n').length * editable.fontSize * 1.2) / 2) * z),
    };
  } else {
    const b = textBounds({ ...editable, text: value || ' ' });
    style = {
      left: sx(b.x) - 2,
      top: sy(b.y) - 2,
      width: Math.max(80, (b.w + 30) * z),
      height: (editable.fontSize * 1.4) * z + 4,
      fontSize: editable.fontSize * z,
      textAlign: editable.anchor === 'middle' ? 'center' : editable.anchor === 'end' ? 'right' : 'left',
    };
  }

  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={style}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => close(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close(false);
        // Labels are one line; box text takes Enter for new lines, Ctrl+Enter to finish.
        else if (e.key === 'Enter' && (editable.type === 'text' || e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          close(true);
        }
      }}
    />
  );
};
