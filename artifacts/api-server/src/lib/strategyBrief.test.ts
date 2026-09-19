import test from "node:test";
import assert from "node:assert/strict";
import {
  DeployStrategyIdeaBody,
  PromoteGapFindingBody,
} from "@workspace/api-zod";

const brief = {
  targetAudience: "Venture-backed founders",
  actionAngle: "Publish a comparison grounded in portfolio benchmarks.",
  proofPoint: "Anonymized portfolio conversion data",
  owner: "Content lead",
  successMetric: "Earn one tracked citation",
};

test("strategy deployment accepts a structured action brief", () => {
  const parsed = DeployStrategyIdeaBody.safeParse({
    ideaId: 1,
    companyId: 1,
    moneyTopic: "venture capital",
    brief,
  });
  assert.equal(parsed.success, true);
});

test("strategy deployment accepts a complete new idea with its action brief", () => {
  const parsed = DeployStrategyIdeaBody.safeParse({
    companyId: 1,
    newIdea: {
      title: "Publish a benchmark teardown",
      category: "on_page",
      playType: "Original Research",
      description: "Turn first-party benchmarks into a reference page.",
      rationale: "Gives answer engines a specific, attributable data source.",
      priority: "P1",
    },
    brief,
  });
  assert.equal(parsed.success, true);
});

test("evidence-backed promotion accepts the same action brief", () => {
  const parsed = PromoteGapFindingBody.safeParse({
    companyId: 1,
    ideaId: 1,
    category: "on_page",
    brief,
  });
  assert.equal(parsed.success, true);
});

test("a blank action angle is rejected", () => {
  const parsed = DeployStrategyIdeaBody.safeParse({
    ideaId: 1,
    companyId: 1,
    brief: { ...brief, actionAngle: "" },
  });
  assert.equal(parsed.success, false);
});