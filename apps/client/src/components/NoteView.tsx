import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { textDiff } from "@foundation/protocol";
import {
  NoteMeta,
  moveNote,
  removeNote,
  resizeNote,
} from "../state/store";
import { renderMarkdown } from "../utils/markdown";
import { activeBoard, editNoteText, onBoardChange, undoNoteText, type NoteCaret } from "../sync/board";
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
 * moving your cursor, and you see where they are writing (their caret and
 * selection, named). ⌘Z takes back only your own typing. Esc or clicking away
 * goes back to the rendered note.
 */
export const NoteView = memo(function NoteView({ note, pos, isActive, getScale }: Props) {
  const [editing, setEditing] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  /** what the editor showed before the last keystroke: the base the keystroke is an edit of */
  const shown = useRef(note.text);
  /** an undo/redo just ran: put the caret where it changed the text */
  const caretToChange = useRef(false);
  const mirror = useRef<HTMLDivElement>(null);
  const carets = useNoteCarets(note.id, note.text);

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
    const toChange = caretToChange.current;
    caretToChange.current = false;
    if (!d || !focused) return;
    if (toChange) {
      el.setSelectionRange(d.at + d.insert.length, d.at + d.insert.length);
      return;
    }
    const shift = (pos: number) => (pos >= d.at + d.remove ? pos + d.insert.length - d.remove : pos > d.at ? d.at + d.insert.length : pos);
    el.setSelectionRange(shift(a), shift(b));
  }, [note.text]);

  useEffect(() => {
    if (!editing) return;
    shown.current = note.text;
    editor.current?.focus();
    const board = activeBoard();
    board?.watchNoteUndo(note.id); // from the first keystroke
    // tell the others where I'm writing, at most once a frame
    let raf = 0;
    const publish = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = editor.current;
        if (!el || document.activeElement !== el) return;
        const back = el.selectionDirection === "backward";
        activeBoard()?.setCaret(note.id, back ? el.selectionEnd : el.selectionStart, back ? el.selectionStart : el.selectionEnd);
      });
    };
    publish();
    document.addEventListener("selectionchange", publish);
    const el = editor.current;
    // the app menu's Edit → Undo arrives as an input event, not a key
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
      e.preventDefault();
      caretToChange.current = undoNoteText(note.id, e.inputType === "historyRedo");
    };
    el?.addEventListener("beforeinput", onBeforeInput);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", publish);
      el?.removeEventListener("beforeinput", onBeforeInput);
      activeBoard()?.setCaret(null);
    };
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {editing && carets.length > 0 && <CaretMirror ref={mirror} text={note.text} carets={carets} scrollTop={editor.current?.scrollTop ?? 0} />}
        {!editing && carets.length > 0 && (
          <div className="note-writers" aria-label="Writing here now">
            {dedupe(carets).map((c) => (
              <span key={c.clientId} className="note-writer" style={{ ["--peer" as string]: c.color }}>
                {c.name}
              </span>
            ))}
          </div>
        )}
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
            onScroll={(e) => {
              if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              const k = e.key.toLowerCase();
              if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === "z" || (k === "y" && e.ctrlKey && !e.metaKey))) {
                // the browser's own undo would rewind past other people's words; this takes back only yours
                e.preventDefault();
                caretToChange.current = undoNoteText(note.id, k === "y" || e.shiftKey);
                return;
              }
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

/** other people's carets in this note; re-renders only when one moves or the text changes */
function useNoteCarets(noteId: string, text: string): NoteCaret[] {
  const [tick, setTick] = useState(0);
  const [board, setBoard] = useState(activeBoard);
  useEffect(() => onBoardChange(() => setBoard(activeBoard())), []);
  useEffect(() => board?.onNoteCarets(noteId, () => setTick((t) => t + 1)), [board, noteId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => board?.noteCarets(noteId) ?? [], [board, noteId, text, tick]);
}

/** one chip per person (two tabs of one person show once) */
function dedupe(carets: NoteCaret[]) {
  const seen = new Set<string>();
  return carets.filter((c) => !seen.has(c.name) && seen.add(c.name));
}

/**
 * A copy of the editor's text laid out exactly like it, invisible, over it:
 * the only way to find where a character sits inside a textarea. It draws the
 * others' selections as a tint and their carets as a named bar.
 */
const CaretMirror = forwardRef<HTMLDivElement, { text: string; carets: NoteCaret[]; scrollTop: number }>(function CaretMirror({ text, carets, scrollTop }, ref) {
  const inner = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (inner.current) inner.current.scrollTop = scrollTop;
  });
  const points = [...new Set([0, text.length, ...carets.flatMap((c) => [c.from, c.to, c.head])])].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < points.length; i++) {
    const at = points[i];
    for (const c of carets)
      if (c.head === at)
        out.push(
          // keyed by where it is, so the name shows again each time they move
          <span key={`c${c.clientId}:${c.head}`} className="note-caret" style={{ ["--peer" as string]: c.color }}>
            <span className="note-caret-name">{c.name}</span>
          </span>,
        );
    const next = points[i + 1];
    if (next === undefined || next === at) continue;
    const seg = text.slice(at, next);
    const by = carets.find((c) => c.from <= at && next <= c.to && c.from !== c.to);
    out.push(
      by ? (
        <mark key={`s${at}`} className="note-peer-sel" style={{ ["--peer" as string]: by.color }}>
          {seg}
        </mark>
      ) : (
        seg
      ),
    );
  }
  return (
    <div
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      className="note-editor note-caret-mirror"
      aria-hidden
    >
      {out}
      {"\u200b"}
    </div>
  );
});
