import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    readdir: fsMocks.readdir,
    stat: fsMocks.stat,
    readFile: fsMocks.readFile,
  },
}));

import { GET } from "@/app/api/docs/route";

const makeRequest = (query = "") => new Request(`http://localhost/api/docs${query}`);

describe("GET /api/docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DOCS_PATH;
  });

  it("returns list of .md files when no file param is provided", async () => {
    fsMocks.readdir.mockResolvedValueOnce([
      { name: "README.md", isFile: () => true },
      { name: "notes.txt", isFile: () => true },
      { name: "subdir", isFile: () => false },
      { name: "AGENTS.md", isFile: () => true },
    ]);

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      files: [
        { name: "AGENTS.md", path: "/Users/hd/Developer/cortana/docs/AGENTS.md" },
        { name: "README.md", path: "/Users/hd/Developer/cortana/docs/README.md" },
      ],
    });
  });

  it("uses DOCS_PATH when explicitly provided", async () => {
    process.env.DOCS_PATH = "/tmp/mission-control-docs";
    fsMocks.readdir.mockResolvedValueOnce([{ name: "README.md", isFile: () => true }]);

    const response = await GET(makeRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      files: [{ name: "README.md", path: "/tmp/mission-control-docs/README.md" }],
    });
  });

  it("returns file content when file param is provided", async () => {
    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });
    fsMocks.readFile.mockResolvedValueOnce("# hello");

    const response = await GET(makeRequest("?file=README.md"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ status: "ok", name: "README.md", content: "# hello" });
  });

  it("rejects path traversal attempts", async () => {
    const response = await GET(makeRequest("?file=../../../etc/passwd"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ status: "error", message: "Invalid file name." });
  });

  it("rejects non-.md file extensions", async () => {
    const response = await GET(makeRequest("?file=notes.txt"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ status: "error", message: "Invalid file name." });
  });

  it("returns 404 for non-existent files", async () => {
    const err = new Error("missing") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    fsMocks.stat.mockRejectedValueOnce(err);

    const response = await GET(makeRequest("?file=missing.md"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ status: "error", message: "File not found." });
  });

  it("returns proper JSON shape for list and content payloads", async () => {
    fsMocks.readdir.mockResolvedValueOnce([{ name: "a.md", isFile: () => true }]);
    let response = await GET(makeRequest());
    let payload = await response.json();

    expect(payload.status).toBe("ok");
    expect(Array.isArray(payload.files)).toBe(true);
    expect(payload.files[0]).toMatchObject({ name: "a.md" });

    fsMocks.stat.mockResolvedValueOnce({ isFile: () => true });
    fsMocks.readFile.mockResolvedValueOnce("content");
    response = await GET(makeRequest("?file=a.md"));
    payload = await response.json();

    expect(payload).toMatchObject({
      status: "ok",
      name: "a.md",
      content: "content",
    });
  });
});
