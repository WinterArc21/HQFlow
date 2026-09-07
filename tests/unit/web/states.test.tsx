import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "@web/components/states/EmptyState";
import { UninitializedState } from "@web/components/states/UninitializedState";
import { AGENT_PROMPT } from "@web/lib/agentPrompt";

describe("EmptyState", () => {
  beforeEach(() => {
    // Stub fetch defensively so a stray action never attempts a real network call from the test
    // environment.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network calls are not expected in this test")),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the copy action and no recheck control", () => {
    render(<EmptyState />);

    expect(screen.getByRole("button", { name: "Map my repository" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recheck files" })).not.toBeInTheDocument();
  });

  it("copies the context-neutral prompt string", async () => {
    // fireEvent (not userEvent) here: userEvent.setup() installs its own Clipboard polyfill
    // whenever navigator.clipboard isn't already its own stub, which would shadow this mock.
    const clipboard = navigator.clipboard as unknown as { writeText: (text: string) => Promise<void> };
    expect(AGENT_PROMPT).toContain("Write .codehq/repository-map.json first");
    expect(AGENT_PROMPT).toContain("assign each workflow to a separate subagent");
    render(<EmptyState />);

    fireEvent.click(screen.getByRole("button", { name: "Map my repository" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(AGENT_PROMPT));
  });

});

describe("UninitializedState", () => {
  it("renders the exact init command", () => {
    render(<UninitializedState />);
    expect(screen.getByText("npx hqflow init")).toBeInTheDocument();
  });

  it("renders a copy control for the command", () => {
    render(<UninitializedState />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
