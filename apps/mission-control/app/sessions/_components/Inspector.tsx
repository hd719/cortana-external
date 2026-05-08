"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Archive, Check, Copy, PencilLine, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "./useFocusTrap";
import type {
  CodexMutationKind,
  CodexSession,
  CodexSessionDetail,
  CodexSessionGroup,
} from "./types";

type CodexSummary = {
  total: number;
  latestUpdatedAt: number | null;
  withCwd: number;
  withPreview: number;
};

type InspectorProps = {
  variant: "session" | "workspace";
  open: boolean;
  onClose: () => void;
  activeCodexSession: CodexSession | CodexSessionDetail | null;
  codexMutationPending: CodexMutationKind | null;
  onRenameCodexSession: () => void;
  onArchiveCodexSession: () => void;
  onDeleteCodexSession: () => void;
  onCopySessionId?: () => void;
  copiedSessionId?: string | null;
  codexSummary: CodexSummary;
  codexVisibleTotal: number;
  visibleCodexSessions: CodexSession[];
  codexSessionGroups: CodexSessionGroup[];
  codexLatestUpdatedAt: number | null;
  formatInt: (value: number) => string;
  formatTimestamp: (value: number | null | undefined) => string;
  formatRelativeTimestamp: (value: number | null | undefined) => string;
  getCodexSessionTitle: (session: Pick<CodexSession, "threadName" | "sessionId"> | null | undefined) => string;
};

export function Inspector({
  variant,
  open,
  onClose,
  activeCodexSession,
  codexMutationPending,
  onRenameCodexSession,
  onArchiveCodexSession,
  onDeleteCodexSession,
  onCopySessionId,
  copiedSessionId,
  codexSummary,
  codexVisibleTotal,
  visibleCodexSessions,
  codexSessionGroups,
  codexLatestUpdatedAt,
  formatInt,
  formatTimestamp,
  formatRelativeTimestamp,
  getCodexSessionTitle,
}: InspectorProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const headingId = variant === "workspace" ? "inspector-workspace-heading" : "inspector-session-heading";

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 10);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [open, onClose]);

  const copiedActive =
    copiedSessionId != null && copiedSessionId === activeCodexSession?.sessionId;

  const sessionTitle = activeCodexSession
    ? getCodexSessionTitle(activeCodexSession)
    : "No thread selected";

  const workspaceTotals = formatInt(codexVisibleTotal || visibleCodexSessions.length);
  const projectCount = formatInt(codexSessionGroups.length);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 motion-safe:transition-opacity motion-safe:duration-200",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close inspector"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-foreground/30 backdrop-blur-sm"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={cn(
          "absolute right-0 top-0 flex h-full w-full flex-col overflow-hidden border-l border-border/60 bg-card shadow-xl motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out sm:w-[22rem]",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
          <div className="min-w-0">
            <h2 id={headingId} className="line-clamp-1 text-sm font-semibold tracking-tight text-foreground">
              {variant === "workspace" ? "Workspace" : sessionTitle}
            </h2>
            {variant === "session" && activeCodexSession?.cwd ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">{activeCodexSession.cwd}</p>
            ) : variant === "workspace" ? (
              <p className="text-xs text-muted-foreground">
                Shared via <code className="font-mono">~/.codex</code>
              </p>
            ) : null}
          </div>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close inspector"
            className="shrink-0 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {variant === "workspace" ? (
            <WorkspaceBody
              codexSummary={codexSummary}
              workspaceTotals={workspaceTotals}
              projectCount={projectCount}
              formatInt={formatInt}
              formatTimestamp={formatTimestamp}
              formatRelativeTimestamp={formatRelativeTimestamp}
              codexLatestUpdatedAt={codexLatestUpdatedAt}
            />
          ) : (
            <SessionBody
              activeCodexSession={activeCodexSession}
              codexMutationPending={codexMutationPending}
              onRenameCodexSession={onRenameCodexSession}
              onArchiveCodexSession={onArchiveCodexSession}
              onDeleteCodexSession={onDeleteCodexSession}
              onCopySessionId={onCopySessionId}
              copiedActive={copiedActive}
              formatTimestamp={formatTimestamp}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <dl className="space-y-3">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className="break-words [overflow-wrap:anywhere] text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SessionBody({
  activeCodexSession,
  codexMutationPending,
  onRenameCodexSession,
  onArchiveCodexSession,
  onDeleteCodexSession,
  onCopySessionId,
  copiedActive,
  formatTimestamp,
}: {
  activeCodexSession: CodexSession | CodexSessionDetail | null;
  codexMutationPending: CodexMutationKind | null;
  onRenameCodexSession: () => void;
  onArchiveCodexSession: () => void;
  onDeleteCodexSession: () => void;
  onCopySessionId?: () => void;
  copiedActive: boolean;
  formatTimestamp: (value: number | null | undefined) => string;
}) {
  const canAct = Boolean(activeCodexSession?.sessionId) && codexMutationPending == null;

  return (
    <>
      <Section label="State">
        <Row
          label="Status"
          value={
            codexMutationPending
              ? "Turn executing"
              : activeCodexSession
                ? "Attached"
                : "Waiting for thread selection"
          }
        />
        <Row label="Model" value={activeCodexSession?.model ?? "Unknown"} />
        <Row label="Updated" value={formatTimestamp(activeCodexSession?.updatedAt ?? null)} />
      </Section>

      <Section label="Working context">
        <Row label="Cwd" value={activeCodexSession?.cwd ?? "Unavailable"} />
        <Row
          label="Session id"
          value={
            <span className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-xs">
                {activeCodexSession?.sessionId ?? "No thread selected"}
              </code>
              {onCopySessionId && activeCodexSession?.sessionId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onCopySessionId()}
                  aria-label="Copy session id"
                  title={copiedActive ? "Copied" : "Copy id"}
                  className="rounded-md"
                >
                  {copiedActive ? <Check className="h-3 w-3 text-blue-600 dark:text-blue-400" /> : <Copy className="h-3 w-3" />}
                </Button>
              ) : null}
            </span>
          }
        />
        <Row
          label="Transcript path"
          value={activeCodexSession?.transcriptPath ?? "Resolved on demand"}
        />
        <Row label="CLI version" value={activeCodexSession?.cliVersion ?? "Unknown"} />
        <Row label="Source" value={activeCodexSession?.source ?? "Unknown"} />
      </Section>

      <Section label="Provider snapshot">
        <Row
          label="Last preview"
          value={activeCodexSession?.lastMessagePreview ?? "—"}
        />
      </Section>

      <section className="mb-4 flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRenameCodexSession()}
          disabled={!canAct}
          className="h-9 justify-start rounded-xl"
        >
          <PencilLine className="mr-2 h-4 w-4" />
          Rename thread
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onArchiveCodexSession()}
          disabled={!canAct}
          className="h-9 justify-start rounded-xl"
        >
          <Archive className="mr-2 h-4 w-4" />
          Archive thread
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDeleteCodexSession()}
          disabled={!canAct}
          className="h-9 justify-start rounded-xl text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete thread
        </Button>
      </section>
    </>
  );
}

function WorkspaceBody({
  codexSummary,
  workspaceTotals,
  projectCount,
  formatInt,
  formatTimestamp,
  formatRelativeTimestamp,
  codexLatestUpdatedAt,
}: {
  codexSummary: CodexSummary;
  workspaceTotals: string;
  projectCount: string;
  formatInt: (value: number) => string;
  formatTimestamp: (value: number | null | undefined) => string;
  formatRelativeTimestamp: (value: number | null | undefined) => string;
  codexLatestUpdatedAt: number | null;
}) {
  return (
    <>
      <Section label="Workspace">
        <Row label="Visible threads" value={workspaceTotals} />
        <Row label="Project groups" value={projectCount} />
        <Row
          label="Last activity"
          value={formatRelativeTimestamp(codexLatestUpdatedAt ?? codexSummary.latestUpdatedAt)}
        />
      </Section>

      <Section label="Coverage">
        <Row label="With cwd" value={formatInt(codexSummary.withCwd)} />
        <Row label="With preview" value={formatInt(codexSummary.withPreview)} />
        <Row label="Total known" value={formatInt(codexSummary.total)} />
      </Section>

      <Section label="Provider snapshot">
        <Row
          label="Codex latest"
          value={formatTimestamp(codexSummary.latestUpdatedAt ?? codexLatestUpdatedAt)}
        />
      </Section>
    </>
  );
}
