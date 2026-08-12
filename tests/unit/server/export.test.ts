import { describe, expect, it } from "vitest";
import type { Workflow } from "@schema/workflow";
import type { WorkflowRecord } from "@core/types";
import {
  buildExportHtml,
  buildContentDisposition,
  sanitizeExportPayload,
  sanitizeFilename,
  type ExportPayload,
} from "@server/export";

const WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "checkout",
  name: "Checkout Flow",
  purpose: "Takes a cart to a confirmed, paid order.",
  steps: [
    {
      id: "create-order",
      name: "Create Order",
      purpose: "Persists a pending order.",
      category: "entry",
      sources: [{ file: "app/api/checkout/route.ts", symbol: "POST", line: 12 }],
    },
  ],
  connections: [],
};

const RECORD: WorkflowRecord = {
  id: "checkout",
  file: ".codehq/workflows/checkout.json",
  workflow: WORKFLOW,
  modifiedAt: "2025-01-01T00:00:00.000Z",
  state: "valid",
  sourceChecks: { "app/api/checkout/route.ts#POST": "verified" },
};

describe("sanitizeExportPayload", () => {
  it("keeps portable workflow data while stripping machine-local metadata", () => {
    const payload = sanitizeExportPayload(RECORD, "my-repo", { exportedAt: "2025-06-01T12:00:00.000Z" });
    const json = JSON.stringify(payload);

    // Machine-local data must never appear in the payload.
    expect(json).not.toContain("repository.root");
    expect(json).not.toContain("codeHQDir");
    expect(json).not.toContain("absolutePath");
    // The workflow JSON's own file path (which would expose the .codehq dir) is stripped.
    expect(json).not.toContain(".codehq/workflows/checkout.json");
    // modifiedAt is not carried into the snapshot.
    expect(json).not.toContain("2025-01-01T00:00:00.000Z");
    expect(payload.workflow).toEqual(WORKFLOW);
    expect(payload.workflowName).toBe("Checkout Flow");
    expect(payload.workflowId).toBe("checkout");
    expect(payload.exportedAt).toBe("2025-06-01T12:00:00.000Z");
    expect(payload.repositoryName).toBe("my-repo");
    expect(payload.hideFilePaths).toBe(false);
    expect(payload.sourceChecks).toEqual({ "app/api/checkout/route.ts#POST": "verified" });
    expect(json).toContain("app/api/checkout/route.ts");
  });

  it("redacts every structured file reference and matching source-check key when requested", () => {
    const workflow: Workflow = {
      ...WORKFLOW,
      entryPoint: { file: "app/api/checkout/route.ts", symbol: "POST" },
      steps: [
        {
          ...WORKFLOW.steps[0]!,
          tests: [{ file: "tests/checkout.test.ts", symbol: "checkoutTest", status: "passing" }],
          edgeCases: [{ name: "Declined", sources: [{ file: "app/api/payments.ts", line: 8 }] }],
        },
      ],
    };
    const record: WorkflowRecord = {
      ...RECORD,
      workflow,
      sourceChecks: {
        "app/api/checkout/route.ts#POST": "verified",
        "tests/checkout.test.ts#checkoutTest": "verified",
        "app/api/payments.ts": "file-only",
      },
    };

    const payload = sanitizeExportPayload(record, "my-repo", { hideFilePaths: true });
    const json = JSON.stringify(payload);

    expect(payload.hideFilePaths).toBe(true);
    expect(json).not.toContain("app/api/checkout/route.ts");
    expect(json).not.toContain("tests/checkout.test.ts");
    expect(json).not.toContain("app/api/payments.ts");
    expect(payload.workflow.entryPoint?.file).toBe("redacted-file-1");
    expect(payload.workflow.steps[0]?.tests?.[0]?.file).toBe("redacted-file-2");
    expect(payload.workflow.steps[0]?.edgeCases?.[0]?.sources?.[0]?.file).toBe("redacted-file-3");
    expect(payload.sourceChecks).toEqual({
      "redacted-file-1#POST": "verified",
      "redacted-file-2#checkoutTest": "verified",
      "redacted-file-3": "file-only",
    });
  });

  it("generates a timestamp when none is provided", () => {
    const payload = sanitizeExportPayload(RECORD, "my-repo");
    expect(typeof payload.exportedAt).toBe("string");
    expect(payload.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("sanitizeFilename", () => {
  it("normalizes, sanitizes, truncates, and falls back safely", () => {
    expect(sanitizeFilename("Checkout Flow")).toBe("checkout-flow");
    expect(sanitizeFilename("My Cool Workflow!")).toBe("my-cool-workflow");
    expect(sanitizeFilename("  spaced  ")).toBe("spaced");
    expect(sanitizeFilename("already-clean")).toBe("already-clean");
    expect(sanitizeFilename("under_score")).toBe("under_score");
    expect(sanitizeFilename("../etc/passwd")).toBe("etcpasswd");
    const long = "a".repeat(200);
    expect(sanitizeFilename(long).length).toBe(80);
    expect(sanitizeFilename("支払いフロー")).toBe("workflow");
  });
});

describe("buildContentDisposition", () => {
  it("produces an attachment header with a sanitized filename", () => {
    const header = buildContentDisposition("Checkout Flow");
    expect(header).toBe('attachment; filename="checkout-flow-codehq.html"');
  });
});

describe("buildExportHtml", () => {
  const PAYLOAD: ExportPayload = {
    workflow: WORKFLOW,
    sourceChecks: { "app/api/checkout/route.ts#POST": "verified" },
    hideFilePaths: false,
    workflowName: "Checkout Flow",
    workflowId: "checkout",
    exportedAt: "2025-06-01T12:00:00.000Z",
    repositoryName: "my-repo",
  };

  const HTML = buildExportHtml({ payload: PAYLOAD, viewerJs: "console.log('hi');", viewerCss: "body{color:red}" });

  it("produces a complete HTML document", () => {
    expect(HTML).toMatch(/^<!doctype html>/i);
    expect(HTML).toContain("<html");
    expect(HTML).toContain("</html>");
    expect(HTML).toContain("<title>Checkout Flow");
  });

  it("inlines the viewer JS and CSS — no external src or href", () => {
    expect(HTML).toContain("console.log('hi');");
    expect(HTML).toContain("body{color:red}");

    // No external script src, link href, or any http/https reference.
    expect(HTML).not.toMatch(/<script[^>]+src=/i);
    expect(HTML).not.toMatch(/<link[^>]+href=/i);
    expect(HTML).not.toMatch(/https?:\/\//i);
  });

  it("embeds the payload as a JSON script tag", () => {
    expect(HTML).toContain('id="codehq-export-payload"');
    expect(HTML).toContain("Checkout Flow");
    expect(HTML).toContain("app/api/checkout/route.ts");
  });

  it("escapes the payload to prevent script injection", () => {
    const malicious: ExportPayload = {
      ...PAYLOAD,
      workflow: {
        ...WORKFLOW,
        name: '</script><script>alert(1)</script>',
      },
    };
    const maliciousHtml = buildExportHtml({ payload: malicious, viewerJs: "", viewerCss: "" });
    // The </script> inside the payload must be escaped, not interpreted as closing the tag.
    expect(maliciousHtml).not.toContain('</script><script>alert(1)');
    expect(maliciousHtml).toContain("\\u003c");
  });

  it("includes the theme bootstrap script", () => {
    expect(HTML).toContain("data-theme");
    expect(HTML).toContain("localStorage");
  });
});
