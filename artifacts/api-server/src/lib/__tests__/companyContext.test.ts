import { describe, it, expect } from "vitest";
import type { Company } from "@workspace/db";
import {
  buildContextSnapshot,
  serializeCompanyContext,
  strategicFraming,
  type CompanyContextSnapshot,
} from "../companyContext";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    name: "Graphite",
    domain: "graphite.dev",
    industry: null,
    objective: null,
    targetAudience: null,
    productsServices: null,
    positioning: null,
    geography: null,
    notes: null,
    profileUpdatedAt: null,
    autoTrackDaily: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Company;
}

describe("companyContext", () => {
  it("returns null when no strategic fields are filled (no fabricated context)", () => {
    expect(serializeCompanyContext(buildContextSnapshot(company()))).toBeNull();
    expect(
      serializeCompanyContext(buildContextSnapshot(company({ industry: "   " }))),
    ).toBeNull();
  });

  it("includes only populated fields, clearly delimited", () => {
    const block = serializeCompanyContext(
      buildContextSnapshot(
        company({ industry: "Developer Tools", objective: "Win AI code review" }),
      ),
    );
    expect(block).toContain("<company_background");
    expect(block).toContain("Industry: Developer Tools");
    expect(block).toContain("Primary objective: Win AI code review");
    expect(block).not.toContain("Target audience");
    expect(block).not.toContain("Research notes");
  });

  it("sanitizes control characters and bounds field length", () => {
    const block = serializeCompanyContext(
      buildContextSnapshot(
        company({ notes: "line1\u0000\u0007" + "x".repeat(1000) }),
      ),
    )!;
    expect(block).not.toContain("\u0000");
    const notesLine = block.split("\n").find((l) => l.startsWith("Research notes:"))!;
    expect(notesLine.length).toBeLessThanOrEqual(620);
  });

  it("strategicFraming uses only the captured snapshot, so later profile edits cannot change it", () => {
    const original = company({
      objective: "Win AI code review",
      targetAudience: "Eng leaders",
      geography: "US",
    });
    const snapshot = buildContextSnapshot(original);

    // Simulate a later profile edit: the live company row changes...
    const edited = company({ objective: "TOTALLY NEW OBJECTIVE", geography: "APAC" });
    const editedSnapshot = buildContextSnapshot(edited);

    // ...but framing derived from the stored job snapshot is unchanged.
    const framing = strategicFraming(snapshot)!;
    expect(framing).toContain("Win AI code review");
    expect(framing).toContain("Eng leaders");
    expect(framing).toContain("markets — US");
    expect(framing).not.toContain("TOTALLY NEW OBJECTIVE");
    expect(framing).toContain("captured when this research ran");
    expect(strategicFraming(editedSnapshot)).toContain("TOTALLY NEW OBJECTIVE");
  });

  it("strategicFraming returns null with no strategic fields or no snapshot (legacy jobs)", () => {
    expect(strategicFraming(null)).toBeNull();
    expect(strategicFraming(undefined)).toBeNull();
    expect(strategicFraming(buildContextSnapshot(company()))).toBeNull();
    expect(
      strategicFraming({
        ...buildContextSnapshot(company()),
        positioning: "framing ignores positioning-only profiles",
      } as CompanyContextSnapshot),
    ).toBeNull();
  });

  it("snapshot captures profile fields and timestamps", () => {
    const snap = buildContextSnapshot(
      company({
        industry: "Fintech",
        profileUpdatedAt: new Date("2026-08-30T10:00:00Z"),
      }),
    );
    expect(snap.version).toBe(1);
    expect(snap.industry).toBe("Fintech");
    expect(snap.profileUpdatedAt).toBe("2026-08-30T10:00:00.000Z");
    expect(typeof snap.capturedAt).toBe("string");
  });
});
