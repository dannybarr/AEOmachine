import { describe, expect, it } from "vitest";
import {
  evidenceExcerptFor,
  groundAndDedupeEntities,
  normalizeEntityName,
  statusAfterFailure,
} from "../entityExtraction";

describe("answer entity extraction helpers", () => {
  it("uses Unicode-aware whole-name boundaries when grounding", () => {
    const answer = "For analytics, ACME Labs is recommended. CaféCo is also mentioned.";
    const grounded = groundAndDedupeEntities(answer, [
      { name: "acme labs" },
      { name: "CaféCo" },
      { name: "ACME" },
      { name: "Missing Inc" },
    ]);
    expect(grounded.map(({ name, relationship }) => ({ name, relationship }))).toEqual([
      { name: "ACME Labs", relationship: "mentioned" },
      { name: "CaféCo", relationship: "mentioned" },
    ]);
  });

  it("normalizes and deduplicates case and whitespace variants", () => {
    expect(normalizeEntityName("  ACME   Labs  ")).toBe("acme labs");
    const grounded = groundAndDedupeEntities("Acme Labs was compared with Beta.", [
      { name: "Acme Labs" },
      { name: "ACME   LABS" },
    ]);
    expect(grounded).toHaveLength(1);
    expect(grounded[0]?.normalizedName).toBe("acme labs");
  });

  it("creates deterministic excerpts from the original answer", () => {
    const answer = `${"x".repeat(120)} Acme Labs ${"y".repeat(120)}`;
    const excerpt = evidenceExcerptFor(answer, "acme labs", 20);
    expect(excerpt).toBe(`…${"x".repeat(19)} Acme Labs ${"y".repeat(19)}…`);
    expect(evidenceExcerptFor("Acmeology is unrelated.", "acme")).toBeNull();
  });

  it("ignores untrusted relationship labels and caps result count", () => {
    const untrusted = [
      { name: "Alpha", relationship: "recommended" },
      { name: "Beta", relationship: "compared" },
    ];
    const grounded = groundAndDedupeEntities(
      "Alpha and Beta are named.",
      untrusted,
      1,
    );
    expect(grounded.map((entity) => entity.name)).toEqual(["Alpha"]);
    expect(grounded[0]?.relationship).toBe("mentioned");
  });

  it("stops retrying at the maximum bounded attempt count", () => {
    expect(statusAfterFailure(1)).toBe("pending");
    expect(statusAfterFailure(2)).toBe("failed");
    expect(statusAfterFailure(20)).toBe("failed");
  });
});