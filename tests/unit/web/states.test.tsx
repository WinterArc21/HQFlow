import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("renders the copy and recheck actions plus discoverable examples", () => {
    render(<EmptyState onRecheck={() => Promise.resolve()} />);

    expect(screen.getByRole("button", { name: "Copy prompt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck files" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copy example" })).toHaveLength(2);
  });

  it("copies the context-neutral prompt string", async () => {
    // fireEvent (not userEvent) here: userEvent.setup() installs its own Clipboard polyfill
    // whenever navigator.clipboard isn't already its own stub, which would shadow this mock.
    const clipboard = navigator.clipboard as unknown as { writeText: (text: string) => Promise<void> };
    expect(AGENT_PROMPT).toBe(
      "Read .codehq/SKILL.md and map the main product workflow.",
    );
    render(<EmptyState onRecheck={() => Promise.resolve()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(AGENT_PROMPT));
  });

  it("calls onRecheck when 'Recheck files' is activated", async () => {
    const onRecheck = vi.fn().mockResolvedValue(undefined);
    render(<EmptyState onRecheck={onRecheck} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Recheck files" }));

    expect(onRecheck).toHaveBeenCalledTimes(1);
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
