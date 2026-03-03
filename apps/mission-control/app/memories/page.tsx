"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type MemoriesResponse = {
  dates: string[];
  content?: string;
  error?: string;
};

type LongTermResponse = {
  content: string;
  updatedAt: string | null;
  error?: string;
};

const formatDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

export default function MemoriesPage() {
  const [activeTab, setActiveTab] = React.useState("daily");

  const [dates, setDates] = React.useState<string[]>([]);
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [dailyContent, setDailyContent] = React.useState("");
  const [dailyLoading, setDailyLoading] = React.useState(true);
  const [dailyContentLoading, setDailyContentLoading] = React.useState(false);
  const [dailyError, setDailyError] = React.useState<string | null>(null);

  const [longTermContent, setLongTermContent] = React.useState("");
  const [longTermUpdatedAt, setLongTermUpdatedAt] = React.useState<string | null>(null);
  const [longTermLoading, setLongTermLoading] = React.useState(false);
  const [longTermLoaded, setLongTermLoaded] = React.useState(false);
  const [longTermError, setLongTermError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const loadDates = async () => {
      try {
        setDailyLoading(true);
        const response = await fetch("/api/memories", { cache: "no-store" });
        const data = (await response.json()) as MemoriesResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load memories");
        if (!mounted) return;
        setDates(data.dates ?? []);
        const first = data.dates?.[0] ?? null;
        setSelectedDate(first);
      } catch (error) {
        if (!mounted) return;
        setDailyError(error instanceof Error ? error.message : "Failed to load memories");
      } finally {
        if (mounted) setDailyLoading(false);
      }
    };

    void loadDates();

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    if (!selectedDate) {
      setDailyContent("");
      return;
    }

    const loadContent = async () => {
      try {
        setDailyContentLoading(true);
        const response = await fetch(`/api/memories?date=${selectedDate}`, { cache: "no-store" });
        const data = (await response.json()) as MemoriesResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load memory content");
        if (!mounted) return;
        setDailyContent(data.content ?? "");
      } catch (error) {
        if (!mounted) return;
        setDailyError(error instanceof Error ? error.message : "Failed to load memory content");
      } finally {
        if (mounted) setDailyContentLoading(false);
      }
    };

    void loadContent();

    return () => {
      mounted = false;
    };
  }, [selectedDate]);

  React.useEffect(() => {
    if (activeTab !== "longterm" || longTermLoaded) return;

    let mounted = true;
    const loadLongTerm = async () => {
      try {
        setLongTermLoading(true);
        const response = await fetch("/api/memories/longterm", { cache: "no-store" });
        const data = (await response.json()) as LongTermResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load long-term memory");
        if (!mounted) return;
        setLongTermContent(data.content ?? "");
        setLongTermUpdatedAt(data.updatedAt ?? null);
        setLongTermLoaded(true);
      } catch (error) {
        if (!mounted) return;
        setLongTermError(error instanceof Error ? error.message : "Failed to load long-term memory");
      } finally {
        if (mounted) setLongTermLoading(false);
      }
    };

    void loadLongTerm();

    return () => {
      mounted = false;
    };
  }, [activeTab, longTermLoaded]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Memory Vault</p>
        <h1 className="text-3xl font-semibold tracking-tight">Memories</h1>
        <p className="mt-1 text-sm text-muted-foreground">Daily notes and long-term memory from OpenClaw.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="border-b">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="daily">Daily Memories</TabsTrigger>
            <TabsTrigger value="longterm">Long-Term Memory</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="daily" className="space-y-4">
          {dailyError ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">{dailyError}</CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <Card className="overflow-hidden">
                <CardHeader className="border-b py-3">
                  <CardTitle className="text-base">Dates</CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[620px] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible">
                    {dailyLoading ? (
                      <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
                    ) : dates.length === 0 ? (
                      <p className="px-2 py-3 text-sm text-muted-foreground">No memories found.</p>
                    ) : (
                      dates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => setSelectedDate(date)}
                          className={cn(
                            "shrink-0 rounded-md border px-3 py-2 text-left text-sm transition-colors lg:w-full",
                            selectedDate === date
                              ? "border-primary/30 bg-primary/10 text-foreground"
                              : "border-border/60 bg-background hover:bg-muted/40"
                          )}
                        >
                          {formatDate(date)}
                        </button>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>{selectedDate ? formatDate(selectedDate) : "Daily Memory"}</span>
                    {selectedDate && <Badge variant="secondary">{selectedDate}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dailyContentLoading ? (
                    <p className="text-sm text-muted-foreground">Loading content…</p>
                  ) : dailyContent.trim() ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-li:marker:text-muted-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-muted prose-pre:text-foreground prose-a:text-primary">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{dailyContent}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No content for this date.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="longterm">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span>Long-Term Memory</span>
                {longTermUpdatedAt && <Badge variant="outline">Updated {new Date(longTermUpdatedAt).toLocaleString()}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {longTermError ? (
                <p className="text-sm text-muted-foreground">{longTermError}</p>
              ) : longTermLoading ? (
                <p className="text-sm text-muted-foreground">Loading MEMORY.md…</p>
              ) : longTermContent.trim() ? (
                <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-li:marker:text-muted-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-muted prose-pre:text-foreground prose-a:text-primary">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{longTermContent}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No long-term memory content yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
