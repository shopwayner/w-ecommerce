"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import { sanitizeProductDescription } from "@/lib/product-description";

type DescriptionFormat = "bold" | "italic" | "underline";

const formatButtons: ReadonlyArray<{
  command: DescriptionFormat;
  label: string;
  title: string;
  textClassName?: string;
}> = [
  { command: "bold", label: "B", title: "Negrito (Ctrl+B)", textClassName: "font-bold" },
  { command: "italic", label: "I", title: "Italico (Ctrl+I)", textClassName: "italic" },
  { command: "underline", label: "U", title: "Sublinhado (Ctrl+U)", textClassName: "underline" }
];

function selectionBelongsToEditor(editor: HTMLElement, range: Range) {
  return editor.contains(range.startContainer) && editor.contains(range.endContainer);
}

export const ProductDescriptionEditor = memo(function ProductDescriptionEditor({
  disabled,
  expanded,
  initialValue,
  onDraftChange,
  resetKey
}: {
  disabled: boolean;
  expanded: boolean;
  initialValue: string;
  onDraftChange: (value: string) => void;
  resetKey: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const draftRef = useRef(sanitizeProductDescription(initialValue));
  const [activeFormats, setActiveFormats] = useState<Record<DescriptionFormat, boolean>>({
    bold: false,
    italic: false,
    underline: false
  });

  useEffect(() => {
    const sanitized = sanitizeProductDescription(initialValue);
    draftRef.current = sanitized;
    savedRangeRef.current = null;
    if (editorRef.current && editorRef.current.innerHTML !== sanitized) {
      editorRef.current.innerHTML = sanitized;
    }
    setActiveFormats({ bold: false, italic: false, underline: false });
  }, [initialValue, resetKey]);

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (selectionBelongsToEditor(editor, range)) {
      savedRangeRef.current = range.cloneRange();
    }
  }, []);

  const refreshActiveFormats = useCallback(() => {
    setActiveFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline")
    });
  }, []);

  const emitDraft = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sanitized = sanitizeProductDescription(editor.innerHTML);
    draftRef.current = sanitized;
    onDraftChange(sanitized);
  }, [onDraftChange]);

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    const range = savedRangeRef.current;
    if (!editor || !range || !selectionBelongsToEditor(editor, range)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const applyFormat = useCallback((command: DescriptionFormat) => {
    if (disabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();
    document.execCommand(command, false);
    emitDraft();
    saveSelection();
    refreshActiveFormats();
  }, [disabled, emitDraft, refreshActiveFormats, restoreSelection, saveSelection]);

  const handleKeyboardShortcut = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const command = ({ b: "bold", i: "italic", u: "underline" } as const)[
      event.key.toLowerCase() as "b" | "i" | "u"
    ];
    if (!command) return;
    event.preventDefault();
    applyFormat(command);
  }, [applyFormat]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    document.execCommand("insertText", false, text);
    emitDraft();
    saveSelection();
  }, [emitDraft, saveSelection]);

  const preserveSelectionOnToolbar = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    saveSelection();
    event.preventDefault();
  }, [saveSelection]);

  return (
    <div
      className={`mt-3 flex min-w-0 flex-col overflow-hidden rounded-md border border-matrix-border bg-matrix-panel transition-[height,min-height] ${
        expanded ? "h-[70vh] min-h-80" : "min-h-56"
      }`}
    >
      <div
        aria-label="Formatacao da descricao"
        className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-matrix-border bg-matrix-panel px-2 py-2"
        role="toolbar"
      >
        {formatButtons.map((format) => (
          <button
            aria-label={format.title}
            aria-pressed={activeFormats[format.command]}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded border text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold ${
              activeFormats[format.command]
                ? "border-matrix-gold bg-matrix-goldSoft text-matrix-goldDark"
                : "border-matrix-border bg-matrix-panel2 text-matrix-fg hover:border-matrix-gold/70"
            } ${format.textClassName ?? ""}`}
            disabled={disabled}
            key={format.command}
            onClick={() => applyFormat(format.command)}
            onMouseDown={preserveSelectionOnToolbar}
            title={format.title}
            type="button"
          >
            {format.label}
          </button>
        ))}
      </div>
      <div
        aria-label="Descricao do produto"
        aria-multiline="true"
        className="matrix-scroll min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 outline-none empty:before:pointer-events-none empty:before:text-matrix-muted empty:before:content-[attr(data-placeholder)] focus:ring-2 focus:ring-inset focus:ring-matrix-gold/20 [&_li]:ml-5 [&_ol]:list-decimal [&_p+p]:mt-3 [&_ul]:list-disc"
        contentEditable={!disabled}
        data-placeholder="Digite a descricao do produto"
        id="product-description-editor"
        onBlur={() => {
          saveSelection();
          emitDraft();
        }}
        onInput={() => {
          emitDraft();
          saveSelection();
          refreshActiveFormats();
        }}
        onKeyDown={handleKeyboardShortcut}
        onKeyUp={() => {
          saveSelection();
          refreshActiveFormats();
        }}
        onMouseUp={() => {
          saveSelection();
          refreshActiveFormats();
        }}
        onPaste={handlePaste}
        ref={editorRef}
        role="textbox"
        spellCheck
        suppressContentEditableWarning
      />
    </div>
  );
});
