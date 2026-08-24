import { describe, expect, it } from "vitest";
import { defaultResults, groupResults, search } from "@web/components/search/searchIndex";
import type { CodeHQSnapshot, WorkflowRecord } from "@web/api/types";
import type { Workflow } from "@schema/workflow";

function makeRecord(workflow: Workflow): WorkflowRecord {
  return {
    id: workflow.id,
    file: `.codehq/workflows/${workflow.id}.json`,
    workflow,
    modifiedAt: new Date().toISOString(),
    state: "valid",
    sourceChecks: {},
  };
}

function makeSnapshot(workflows: Workflow[]): CodeHQSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    status: "ready",
    repository: { name: "demo", root: "/demo", codeHQDir: "/demo/.codehq" },
    project: null,
    workflows: workflows.map(makeRecord),
    diagnostics: { generatedAt: new Date().toISOString(), valid: true, issues: [] },
  };
}

const TIER_WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "checkout",
  name: "Checkout",
  purpose: "Captures payment for a cart.",
  steps: [
    { id: "login", name: "Login", purpose: "Authenticates the user before checkout begins." },
    { id: "login-flow", name: "Login Flow", purpose: "Runs the multi-step sign-in sequence." },
    { id: "handler", name: "User Login Handler", purpose: "Handles a completed sign-in callback." },
  ],
  connections: [],
};

const NAME_VS_BODY_WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "onboarding",
  name: "Onboarding",
  purpose: "Gets a new user set up.",
  steps: [
    // Query "widget" appears only as a SUBSTRING of this step's name.
    { id: "render", name: "Render Widget Gallery", purpose: "Lays out the dashboard tiles." },
    // Query "widget" appears as an EXACT match of this step's purpose in isolation — the
    // strongest possible body-field match — yet it must still rank below the name match above.
    { id: "describe", name: "Finish Setup", purpose: "widget" },
  ],
  connections: [],
};

const RICH_WORKFLOW: Workflow = {
  schemaVersion: "0.1",
  id: "generate-video",
  name: "Generate Video",
  purpose: "Turns a website into a video prompt.",
  steps: [
    {
      id: "scrape",
      name: "Scrape Website",
      purpose: "Fetches pages from the target site.",
      sources: [{ file: "lib/scraper.ts", symbol: "scrapeWebsite" }],
      edgeCases: [{ name: "Website blocks automated requests", handling: "Marks the job failed." }],
      tests: [{ file: "tests/unit/lib/scraper.test.ts", symbol: "handles a 403 response" }],
    },
  ],
  connections: [],
};

describe("search", () => {
  it("ranks name match quality first and name fields above body fields", () => {
    const snapshot = makeSnapshot([TIER_WORKFLOW]);
    const results = search(snapshot, "Login").filter((result) => result.kind === "step");

    expect(results.map((result) => result.title)).toEqual(["Login", "Login Flow", "User Login Handler"]);
    const bodyResults = search(makeSnapshot([NAME_VS_BODY_WORKFLOW]), "widget").filter((result) => result.kind === "step");
    expect(bodyResults.map((result) => result.title)).toEqual(["Render Widget Gallery", "Finish Setup"]);
  });

  it("indexes source, edge-case, and test metadata", () => {
    const snapshot = makeSnapshot([RICH_WORKFLOW]);
    expect(search(snapshot, "scraper.ts").some((result) => result.kind === "source")).toBe(true);
    expect(search(snapshot, "scrapeWebsite").some((result) => result.kind === "source")).toBe(true);
    expect(search(snapshot, "blocks automated").some((result) => result.kind === "edge-case")).toBe(true);
    expect(search(snapshot, "scraper.test.ts").some((result) => result.kind === "test")).toBe(true);
    expect(search(snapshot, "403 response").some((result) => result.kind === "test")).toBe(true);
  });

  it("handles empty and unmatched queries", () => {
    const snapshot = makeSnapshot([TIER_WORKFLOW, RICH_WORKFLOW]);

    expect(search(snapshot, "")).toEqual(defaultResults(snapshot));
    expect(defaultResults(snapshot).map((result) => result.workflowId)).toEqual(["checkout", "generate-video"]);
    expect(search(snapshot, "xyzzy-not-present-anywhere")).toEqual([]);
  });
});

describe("groupResults", () => {
  it("groups results by kind, in the fixed display order, preserving relative rank", () => {
    const snapshot = makeSnapshot([RICH_WORKFLOW]);
    const groups = groupResults(search(snapshot, "scrape"));

    expect(groups.map((group) => group.kind)).toEqual(["step", "source", "test"]);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });
});
