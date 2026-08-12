/**
 * Clipboard write with browser fallbacks. The async Clipboard API is preferred. Some embedded
 * browsers deny that API even for a user click, so the legacy copy command is retained as a
 * narrow fallback before HQFlow asks the user to copy a selected value manually.
 */

export type ClipboardOutcome = "copied" | "manual-selection" | "unavailable";

function selectForManualCopy(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  window.setTimeout(() => {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }, 2000);
  return true;
}

function copyWithLegacyCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export async function copyToClipboard(text: string): Promise<ClipboardOutcome> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // Permission denied or a transient browser error — try the embedded-browser fallback.
    }
  }
  if (copyWithLegacyCommand(text)) {
    return "copied";
  }
  return selectForManualCopy(text) ? "manual-selection" : "unavailable";
}
