import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameThreadDialog } from "./RenameThreadDialog";

describe("RenameThreadDialog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not select newly typed text when the delayed focus callback runs", async () => {
    vi.useFakeTimers();

    render(
      <RenameThreadDialog
        sessionId="session-1"
        currentTitle="Old title"
        pending={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Thread name") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Mission" } });
    input.setSelectionRange(input.value.length, input.value.length);

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
