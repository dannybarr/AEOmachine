import { describe, expect, it } from "vitest";
import {
  classifyEntityRelationship,
  classifyVisibilityRung,
  domainMatchesCompany,
} from "../visibilityRung";

describe("classifyEntityRelationship", () => {
  it("detects explicit recommendation language", () => {
    expect(classifyEntityRelationship("I recommend Love Ventures for UK EIS.", "Love Ventures")).toBe(
      "recommended",
    );
    expect(
      classifyEntityRelationship("Love Ventures is recommended for Future of Work.", "Love Ventures"),
    ).toBe("recommended");
  });

  it("does not treat negated recommendation as recommended", () => {
    expect(
      classifyEntityRelationship("I do not recommend Love Ventures for this.", "Love Ventures"),
    ).toBe("mentioned");
  });

  it("detects comparison language", () => {
    expect(
      classifyEntityRelationship("Love Ventures versus Seedcamp on seed tickets.", "Love Ventures"),
    ).toBe("compared");
  });

  it("falls back to mentioned when the name is present without recommend/compare language", () => {
    expect(classifyEntityRelationship("Love Ventures is a UK EIS fund.", "Love Ventures")).toBe(
      "mentioned",
    );
  });

  it("returns other when the name is absent", () => {
    expect(classifyEntityRelationship("Fuel Ventures leads this list.", "Love Ventures")).toBe("other");
  });
});

describe("classifyVisibilityRung", () => {
  it("returns recommended when the answer picks the brand, even if also cited", () => {
    expect(
      classifyVisibilityRung({
        answerText: "The best option is Love Ventures.",
        brandName: "Love Ventures",
        brandMentioned: true,
        companyDomain: "loveventures.co.uk",
        citationDomains: ["loveventures.co.uk"],
      }),
    ).toBe("recommended");
  });

  it("returns cited when the brand domain appears in verified citations", () => {
    expect(
      classifyVisibilityRung({
        answerText: "Love Ventures is a UK EIS fund.",
        brandName: "Love Ventures",
        brandMentioned: true,
        companyDomain: "loveventures.co.uk",
        citationDomains: ["www.loveventures.co.uk", "seedcamp.com"],
      }),
    ).toBe("cited");
  });

  it("returns cited when the brand is unnamed in prose but its domain is cited", () => {
    expect(
      classifyVisibilityRung({
        answerText: "Several UK funds appear in this roundup.",
        brandName: "Love Ventures",
        brandMentioned: false,
        companyDomain: "loveventures.co.uk",
        citationDomains: ["blog.loveventures.co.uk"],
      }),
    ).toBe("cited");
  });

  it("returns mentioned when the brand is named without citation gravity", () => {
    expect(
      classifyVisibilityRung({
        answerText: "Love Ventures is a UK EIS fund.",
        brandName: "Love Ventures",
        brandMentioned: true,
        companyDomain: "loveventures.co.uk",
        citationDomains: ["seedcamp.com"],
      }),
    ).toBe("mentioned");
  });

  it("returns absent when the brand is neither named nor cited", () => {
    expect(
      classifyVisibilityRung({
        answerText: "Ascension and Fuel Ventures lead this list.",
        brandName: "Love Ventures",
        brandMentioned: false,
        companyDomain: "loveventures.co.uk",
        citationDomains: ["fuel.ventures"],
      }),
    ).toBe("absent");
  });

  it("matches company subdomains as owned citation gravity", () => {
    expect(domainMatchesCompany("news.loveventures.co.uk", "loveventures.co.uk")).toBe(true);
    expect(domainMatchesCompany("loveventures.co.uk", "fuel.ventures")).toBe(false);
  });
});
