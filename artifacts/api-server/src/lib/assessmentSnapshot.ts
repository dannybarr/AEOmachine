export interface SnapshotJob {
  id: number;
  status: "running" | "completed" | "failed";
}

export interface AssessmentSnapshotSelection {
  currentJobId: number;
  profileJobId: number | null;
  pagesJobId: number | null;
  auditJobId: number | null;
}

/**
 * Keeps the newest job visible without allowing its partial crawl to replace
 * independently durable artifacts from the latest finished assessment.
 */
export function selectAssessmentSnapshot(
  jobs: readonly SnapshotJob[],
  artifacts: {
    profileJobIds: readonly number[];
    pagesJobIds: readonly number[];
    auditJobIds: readonly number[];
  },
): AssessmentSnapshotSelection | null {
  const current = [...jobs].sort((a, b) => b.id - a.id)[0];
  if (!current) return null;
  const finished = new Set(jobs.filter((job) => job.status !== "running").map((job) => job.id));
  const latest = (ids: readonly number[]) =>
    [...new Set(ids)].filter((id) => finished.has(id)).sort((a, b) => b - a)[0] ?? null;
  return {
    currentJobId: current.id,
    profileJobId: latest(artifacts.profileJobIds),
    pagesJobId: latest(artifacts.pagesJobIds),
    auditJobId: latest(artifacts.auditJobIds),
  };
}