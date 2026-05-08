"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "./useFocusTrap";

type RenameThreadDialogProps = {
  sessionId: string;
  currentTitle: string;
  pending: boolean;
  onCancel: () => void;
  onSave: (sessionId: string, threadName: string) => void;
};

function normalizeThreadName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function RenameThreadDialog({
  sessionId,
  currentTitle,
  pending,
  onCancel,
  onSave,
}: RenameThreadDialogProps) {
  const [draftTitle, setDraftTitle] = useState(() => currentTitle);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel, pending]);

  const normalizedDraftTitle = useMemo(() => normalizeThreadName(draftTitle), [draftTitle]);
  const saveDisabled = pending || !normalizedDraftTitle || normalizedDraftTitle === currentTitle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-thread-heading"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Cancel rename"
        onClick={onCancel}
        disabled={pending}
        className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm disabled:cursor-default"
      />
      <form
        ref={dialogRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (!saveDisabled) {
            onSave(sessionId, normalizedDraftTitle);
          }
        }}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-xl"
      >
        <h2
          id="rename-thread-heading"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          Rename thread
        </h2>
        <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="rename-thread-name">
          Thread name
        </label>
        <input
          ref={inputRef}
          id="rename-thread-name"
          type="text"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          maxLength={120}
          disabled={pending}
          className="mt-2 h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:opacity-60 dark:border-border/40"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-xl border border-border/60 bg-background px-4 text-sm font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50 dark:border-border/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saveDisabled}
            className="inline-flex h-9 items-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
