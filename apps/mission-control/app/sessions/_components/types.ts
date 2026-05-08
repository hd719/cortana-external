export type CodexSession = {
  sessionId: string;
  threadName: string | null;
  updatedAt: number | null;
  cwd: string | null;
  model: string | null;
  source: string | null;
  isSubagent?: boolean;
  cliVersion: string | null;
  lastMessagePreview: string | null;
  transcriptPath: string | null;
  activeRun?: boolean;
};

export type CodexSessionGroup = {
  id: string;
  label: string;
  rootPath: string;
  isActive: boolean;
  isCollapsed: boolean;
  sessions: CodexSession[];
};

export type CodexSessionEvent = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number | null;
  phase: string | null;
  rawType: string;
};

export type CodexSessionDetail = CodexSession & {
  events: CodexSessionEvent[];
};

export type CodexSessionPagination = {
  totalEvents: number;
  loadedEvents: number;
  hasMore: boolean;
  nextBefore: number | null;
  rangeStart: number;
  rangeEnd: number;
};

export type StreamingCodexEvent = {
  id: string;
  role: "assistant";
  text: string;
};

export type CodexSessionsResponse = {
  sessions: CodexSession[];
  groups: CodexSessionGroup[];
  latestUpdatedAt: number | null;
  totalMatchedSessions: number;
  totalVisibleSessions: number;
  error?: string;
};

export type CodexSessionDetailResponse = {
  session?: CodexSessionDetail;
  pagination?: CodexSessionPagination;
  error?: string;
};

export type CodexRunErrorCode =
  | "invalid_request"
  | "conflict"
  | "not_found"
  | "prerequisite_failed";

export type CodexRunStartResponse = {
  streamId?: string;
  error?: string;
  code?: CodexRunErrorCode;
};

export type CodexStreamEnvelope = {
  event: string;
  data: unknown;
};

export type WorkspaceOption = {
  key: string;
  label: string;
  cwd: string;
};

export type CodexMutationKind = "create" | "reply" | "archive" | "delete" | "rename";
