import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAssessmentSnapshot } from "./assessmentSnapshot";

test("current rerun does not hide durable snapshots from a finished job", () => {
  const selected = selectAssessmentSnapshot(
    [{ id: 12, status: "running" }, { id: 11, status: "completed" }],
    { profileJobIds: [11], pagesJobIds: [11, 12], auditJobIds: [11] },
  );
  assert.deepEqual(selected, {
    currentJobId: 12,
    profileJobId: 11,
    pagesJobId: 11,
    auditJobId: 11,
  });
});

test("a failed job may retain an independently completed durable audit", () => {
  const selected = selectAssessmentSnapshot(
    [{ id: 4, status: "failed" }, { id: 3, status: "completed" }],
    { profileJobIds: [3], pagesJobIds: [3, 4], auditJobIds: [3, 4] },
  );
  assert.equal(selected?.auditJobId, 4);
  assert.equal(selected?.pagesJobId, 4);
  assert.equal(selected?.profileJobId, 3);
});