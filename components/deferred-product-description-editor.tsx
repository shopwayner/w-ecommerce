"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent
} from "react";
import type { ProductDescriptionEditorProps } from "@/components/product-description-editor";

type DeferredEditor = ComponentType<ProductDescriptionEditorProps>;

export function DeferredProductDescriptionEditor(
  props: Omit<ProductDescriptionEditorProps, "focusOnMount">
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<Promise<DeferredEditor> | null>(null);
  const mountedRef = useRef(true);
  const focusRequestedRef = useRef(false);
  const [Editor, setEditor] = useState<DeferredEditor | null>(null);
  const [focusOnMount, setFocusOnMount] = useState(false);

  const loadEditor = useCallback((requestFocus = false) => {
    if (requestFocus) focusRequestedRef.current = true;
    if (!importRef.current) {
      importRef.current = import("@/components/product-description-editor")
        .then((module) => module.ProductDescriptionEditor);
    }
    void importRef.current.then((LoadedEditor) => {
      if (!mountedRef.current) return;
      setFocusOnMount(focusRequestedRef.current);
      setEditor(() => LoadedEditor);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || Editor) return;
    if (!("IntersectionObserver" in window)) {
      loadEditor();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadEditor();
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [Editor, loadEditor]);

  if (Editor) {
    return <Editor {...props} focusOnMount={focusOnMount} />;
  }

  function requestInteractiveEditor() {
    if (!props.disabled) loadEditor(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    requestInteractiveEditor();
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    requestInteractiveEditor();
  }

  return (
    <div
      aria-busy="true"
      aria-label="Carregando editor da descrição"
      className={`mt-3 flex min-w-0 flex-col overflow-hidden rounded-md border border-matrix-border bg-matrix-panel transition-[height,min-height] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-matrix-gold ${
        props.expanded ? "h-[70vh] min-h-80" : "min-h-56"
      }`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      ref={containerRef}
      role="group"
      tabIndex={props.disabled ? -1 : 0}
    >
      <div
        aria-hidden="true"
        className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-matrix-border bg-matrix-panel px-2 py-2"
      >
        {(["B", "I", "U"] as const).map((label) => (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded border border-matrix-border bg-matrix-panel2 text-sm text-matrix-muted"
            key={label}
          >
            {label}
          </span>
        ))}
      </div>
      <div
        className="matrix-scroll min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-sm leading-6 text-matrix-fg [&_li]:ml-5 [&_ol+p]:mt-3 [&_ol]:list-decimal [&_p+ol]:mt-1 [&_p+p]:mt-3 [&_p+ul]:mt-1 [&_ul+p]:mt-3 [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: props.initialValue }}
      />
    </div>
  );
}
