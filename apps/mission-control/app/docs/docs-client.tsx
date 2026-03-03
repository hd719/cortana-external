"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DocFile = { name: string; path: string };

type DocsListResponse =
  | { status: "ok"; files: DocFile[] }
  | { status: "error"; message: string };

type DocContentResponse =
  | { status: "ok"; name: string; content: string }
  | { status: "error"; message: string };

export default function DocsClient() {
  const [files, setFiles] = React.useState<DocFile[]>([]);
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string>("");
  const [listLoading, setListLoading] = React.useState(true);
  const [contentLoading, setContentLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [contentError, setContentError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const loadList = async () => {
      try {
        setListLoading(true);
        const response = await fetch("/api/docs", { cache: "no-store" });
        const payload = (await response.json()) as DocsListResponse;
        if (!response.ok || payload.status !== "ok") {
          const message =
            payload.status === "error" ? payload.message : "Failed to load docs.";
          throw new Error(message);
        }

        const sorted = [...payload.files].sort((a, b) => a.name.localeCompare(b.name));
        if (active) {
          setFiles(sorted);
          setSelectedFile(sorted[0]?.name ?? null);
          setListError(null);
        }
      } catch (error) {
        if (active) {
          setListError(error instanceof Error ? error.message : "Failed to load docs.");
        }
      } finally {
        if (active) setListLoading(false);
      }
    };

    void loadList();

    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;

    const loadDoc = async () => {
      if (!selectedFile) {
        setContent("");
        setContentError(null);
        return;
      }

      try {
        setContentLoading(true);
        const response = await fetch(`/api/docs?file=${encodeURIComponent(selectedFile)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as DocContentResponse;
        if (!response.ok || payload.status !== "ok") {
          const message =
            payload.status === "error" ? payload.message : "Failed to load doc.";
          throw new Error(message);
        }

        if (active) {
          setContent(payload.content);
          setContentError(null);
        }
      } catch (error) {
        if (active) {
          setContentError(error instanceof Error ? error.message : "Failed to load doc.");
        }
      } finally {
        if (active) setContentLoading(false);
      }
    };

    void loadDoc();

    return () => {
      active = false;
    };
  }, [selectedFile]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            OpenClaw Docs
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse markdown documentation from the OpenClaw knowledge base.
          </p>
        </div>
        <Badge variant="outline">DOCS_PATH</Badge>
      </div>

      {listError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base">Docs unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{listError}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center justify-between text-base">
                Files
                <Badge variant="secondary">{files.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="max-h-[360px] space-y-1 overflow-y-auto px-3 py-2 md:max-h-[520px]">
                {listLoading ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    Loading docs...
                  </p>
                ) : files.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    No markdown files found.
                  </p>
                ) : (
                  files.map((file) => {
                    const isActive = file.name === selectedFile;
                    return (
                      <button
                        key={file.name}
                        type="button"
                        onClick={() => setSelectedFile(file.name)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "border-primary/30 bg-primary/10 text-foreground"
                            : "border-border/60 bg-background/70 text-muted-foreground hover:bg-muted/40"
                        )}
                      >
                        <span className="truncate font-medium text-foreground">{file.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle className="text-base">
                {selectedFile ?? "Documentation"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {contentLoading ? (
                <p className="text-sm text-muted-foreground">Loading content...</p>
              ) : contentError ? (
                <p className="text-sm text-muted-foreground">{contentError}</p>
              ) : !content.trim() ? (
                <p className="text-sm text-muted-foreground">No content available.</p>
              ) : (
                <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-primary prose-strong:text-foreground prose-code:text-foreground prose-pre:bg-muted/40">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
