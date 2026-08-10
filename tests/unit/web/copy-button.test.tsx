import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "@web/components/primitives/CopyButton";

// `fireEvent` (not `userEvent`) is used deliberately in this file: `userEvent.setup()`
// installs its own Clipboard polyfill on `navigator.clipboard` whenever one isn't already
// present, which would silently override the exact mocks/absence being tested here.
describe("CopyButton", () => {
  const originalClipboard = navigator.clipboard as Clipboard | undefined;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
    vi.restoreAllMocks();
  });

  it("shows a transient Copied state on the success path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<CopyButton value="hello world" label="Copy" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("copies in one click with the embedded-browser fallback when the Clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    render(<CopyButton value="hello world" label="Copy" />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Copy" }))).not.toThrow();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
