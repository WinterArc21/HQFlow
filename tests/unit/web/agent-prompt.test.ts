import { describe, expect, it } from "vitest";
import { composeWorkflowAgentPrompt, workflowFilePath, workflowMention } from "@web/lib/agentPrompt";

describe("workflow agent prompts", () => {
  it("derives distinct stable mentions and exact paths from workflow IDs", () => {
    expect(workflowMention("auth-workflow")).toBe("@auth-workflow");
    expect(workflowMention("checkout")).toBe("@checkout");
    expect(workflowFilePath("auth-workflow")).toBe(".codehq/workflows/auth-workflow.json");
    expect(workflowFilePath("checkout")).toBe(".codehq/workflows/checkout.json");
  });

  it("adds portable identity while preserving the request exactly", () => {
    const request = "  @auth-workflow is too bird's-eye; make it more detailed.\nKeep *all* edge cases.  ";
    const prompt = composeWorkflowAgentPrompt("auth-workflow", request);

    expect(prompt).toContain("Workflow: @auth-workflow");
    expect(prompt).toContain("File: .codehq/workflows/auth-workflow.json");
    expect(prompt.endsWith(request)).toBe(true);
    expect(prompt).not.toContain("hqflow validate");
  });
});
