import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { textDiff } from "@foundation/protocol";
import {
  NoteMeta,
  moveNote,
  removeNote,
  resizeNote,
} from "../state/store";
import { renderMarkdown } from "../utils/markdown";
import { editNoteText } from "../sync/board";
import { getUi } from "../state/ui";
import { openExternal } from "../utils/media";
import { ObjectFrame } from "./ObjectFrame";

interface Props {
  note: NoteMeta;
  pos: { x: number; y: number };
  isActive: boolean;
  getScale(): number;
}

/**
 * A markdown note. Double-click to write in it; every keystroke goes out as
 * it's typed (a small edit to the note's shared text), so two people can
 * write in one note at once. Someone else's words land in your editor without
 * moving your cursor. Esc or clicking away goes back to the rendered note.
 */
export const NoteView = memo(function NoteView({ note, pos, isActive, getScale }: Props) {
  const [editing, setEditing] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  /** what the editor showed before the last keystroke: the base the keystroke is an edit of */
  const shown = useRef(note.text);

  const html = useMemo(() => renderMarkdown(note.text), [note.text]);

  // text from elsewhere (a person or an agent) while this editor is open: splice it in, keep the caret
  useLayoutEffect(() => {
    const el = editor.current;
    if (!el) return;
    shown.current = note.text;
    if (el.value === note.text) return;
    const d = textDiff(el.value, note.text);
    const focused = document.activeElement === el;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    el.value = note.text;
    if (!d || !focused) return;
    const shift = (pos: number) => (pos >= d.at + d.remove ? pos + d.insert.length - d.remove : pos > d.at ? d.at + d.insert.length : pos);
    el.setSelectionRange(shift(a), shift(b));
  }, [note.text]);

  useEffect(() => {
    if (editing) {
      shown.current = note.text;
      editor.current?.focus();
    }
  }, [editing]);

  const onBodyClick = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a[data-ext]");
    if (a) {
      e.preventDefault();
      void openExternal((a as HTMLAnchorElement).href);
    }
  }, []);

  return (
    <ObjectFrame
      id={note.id}
      title={note.name}
      pos={pos}
      width={note.w}
      float={note.float}
      isActive={isActive}
      getScale={getScale}
      onMove={(x, y) => moveNote(note.id, x, y)}
      onResize={(dw, dh) => resizeNote(note.id, note.w + dw, note.h + dh)}
      onRemove={() => removeNote(note.id)}
      bodyClass="note-body"
    >
      <div style={{ height: note.h }} className="note-inner">
        {editing ? (
          <textarea
            ref={editor}
            className="note-editor"
            defaultValue={note.text}
            spellCheck={false}
            onChange={(e) => {
              const base = shown.current;
              shown.current = e.target.value;
              editNoteText(note.id, base, e.target.value);
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) setEditing(false);
            }}
          />
        ) : (
          <div
            className="note-rendered"
            onDoubleClick={() => getUi().role !== "viewer" && setEditing(true)}
            onClick={onBodyClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </ObjectFrame>
  );
});
