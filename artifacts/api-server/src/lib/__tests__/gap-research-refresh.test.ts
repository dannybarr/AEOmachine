import { describe, expect, it } from "vitest";
import type { GapResearchJob } from "@workspace/db";
import {
  AUTO_RESEARCH_COOLDOWN_MS,
  isAutomaticResearchRefreshDue,
} from "../gapResearchRunner";

function completedJob(createdAt: Date): GapResearchJob {
  return { createdAt } as GapResearchJob;
}

describe("automatic gap research refresh cooldown", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("is due when no completed research snapshot exists", () => {
    expect(isAutomaticResearchRefreshDue(null, now)).toBe(true);
  });

  it("is not due while the latest completed snapshot is inside the cooldown", () => {
    const latest = completedJob(new Date(now.getTime() - AUTO_RESEARCH_COOLDOWN_MS + 1));
    expect(isAutomaticResearchRefreshDue(latest, now)).toBe(false);
  });

  it("is due at the cooldown boundary", () => {
    const latest = completedJob(new Date(now.getTime() - AUTO_RESEARCH_COOLDOWN_MS));
    expect(isAutomaticResearchRefreshDue(latest, now)).toBe(true);
  });
});