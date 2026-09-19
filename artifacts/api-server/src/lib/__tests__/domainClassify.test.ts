import { describe, expect, it } from "vitest";
import { citationMixBucket, heuristicType, normalizeDomain } from "../domainClassify";

describe("citation source taxonomy", () => {
  it("normalizes full URLs before classification", () => {
    expect(normalizeDomain("https://www.OpenVC.app/investors")).toBe("openvc.app");
  });

  it("keeps owned domains ahead of source-role heuristics", () => {
    expect(heuristicType("news.brand.example", "brand.example")).toBe("you");
  });

  it("recognizes directories, comparisons, editorial, and UK institutions", () => {
    expect(heuristicType("vc-mapping.gilion.com", "example.com")).toBe("directory");
    expect(heuristicType("nerdwallet.com", "example.com")).toBe("comparison");
    expect(heuristicType("finance.yahoo.com", "example.com")).toBe("editorial");
    expect(heuristicType("nssif.gov.uk", "example.com")).toBe("institutional");
  });

  it("does not treat every dot-org publisher as an institution or company site", () => {
    expect(heuristicType("savethestudent.org", "example.com")).toBe("comparison");
    expect(heuristicType("angelcapitalassociation.org", "example.com")).toBe("other");
    expect(heuristicType("example.org", "brand.com")).toBe("other");
  });

  it("classifies known publishers and article paths as media instead of corporate", () => {
    expect(heuristicType("blog.semrush.com", "example.com")).toBe("editorial");
    expect(
      heuristicType(
        "unknownpublisher.com",
        "example.com",
        "https://unknownpublisher.com/insights/industry-report",
      ),
    ).toBe("editorial");
    expect(heuristicType("unknowncompany.com", "example.com", "https://unknowncompany.com/")).toBe("other");
  });

  it("recognizes historical UK academic subdomains as institutional", () => {
    expect(heuristicType("research.lse.ac.uk", "example.com")).toBe("institutional");
  });

  it("maps source types into stable chart buckets", () => {
    expect(citationMixBucket("directory")).toBe("directory");
    expect(citationMixBucket("comparison")).toBe("comparison");
    expect(citationMixBucket("reference")).toBe("editorial");
    expect(citationMixBucket("corporate")).toBe("other");
    expect(citationMixBucket("future-type")).toBe("other");
  });
});