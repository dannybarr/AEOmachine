/**
 * Locked AEO visibility ladder (Love Ventures / Velocity methodology).
 *
 * recommended → cited → mentioned → absent
 *
 * Relationship labels are derived from the saved answer text around the
 * tracked name, never from untrusted model-supplied classifiers. Citation
 * gravity uses verified provider citation domains only — never URLs parsed
 * from prose.
 */

export type VisibilityRung = "recommended" | "cited" | "mentioned" | "absent";
export type EntityRelationship = "recommended" | "compared" | "mentioned" | "other";

export function normalizeDomainHost(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

/** True when a citation domain is the company site or a subdomain of it. */
export function domainMatchesCompany(citationDomain: string, companyDomain: string): boolean {
  const citation = normalizeDomainHost(citationDomain);
  const company = normalizeDomainHost(companyDomain);
  if (!citation || !company) return false;
  return citation === company || citation.endsWith(`.${company}`);
}

function findName(answerText: string, name: string): { index: number; length: number } | null {
  const cleaned = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 120) return null;
  const escaped = cleaned
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(
    answerText,
  );
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

function sentenceAt(text: string, index: number, length: number): string {
  const before = text.slice(0, index);
  const startCandidates = [before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n")];
  const start = Math.max(-1, ...startCandidates) + 1;
  const rest = text.slice(index + length);
  const ends = [".", "!", "?", "\n"]
    .map((ch) => rest.indexOf(ch))
    .filter((i) => i >= 0);
  const end = ends.length > 0 ? index + length + Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * Classify how an entity is discussed in the answer. Conservative: a name
 * without recommend/compare language is "mentioned". Names that do not occur
 * in the answer are "other".
 */
export function classifyEntityRelationship(
  answerText: string,
  name: string,
): EntityRelationship {
  const found = findName(answerText, name);
  if (!found) return "other";
  const sentence = sentenceAt(answerText, found.index, found.length);
  const negatedRecommend =
    /\b(?:do not|don't|does not|doesn't|did not|didn't|not|never|cannot|can't|wouldn't|would not)\b[\s\S]{0,48}\brecommend/i.test(
      sentence,
    ) || /\brecommend[\s\S]{0,32}\b(?:against|avoiding)\b/i.test(sentence);

  if (!negatedRecommend) {
    const recommended =
      /\b(?:i|we|i'd|i’d|i would|we would)\b[\s\S]{0,48}\b(?:recommend|suggest|choose|pick)\b/i.test(
        sentence,
      ) ||
      /\b(?:highly |strongly )?recommend(?:ed|s|ing)?\b/i.test(sentence) ||
      /\b(?:is|are|was|were)\b[\s\S]{0,24}\b(?:a |the )?(?:strong |solid |good |great |top |best )?(?:choice|pick|option|recommendation|fit)\b/i.test(
        sentence,
      ) ||
      /\b(?:top|best)\s+(?:pick|choice|option|shortlist)\b/i.test(sentence) ||
      /\bshortlist\b/i.test(sentence) ||
      /\b(?:should|would)\s+(?:consider|choose|go with)\b/i.test(sentence);
    if (recommended) return "recommended";
  }

  if (
    /\b(?:compared (?:to|with)|versus|vs\.?|alternative to|rather than|instead of)\b/i.test(
      sentence,
    )
  ) {
    return "compared";
  }
  return "mentioned";
}

export interface VisibilityRungInput {
  answerText: string;
  brandName: string;
  brandMentioned: boolean;
  companyDomain: string;
  citationDomains: string[];
}

/**
 * Scoreboard rung for one successful run.
 *
 * recommended — explicit pick / shortlist language for the tracked brand
 * cited       — brand domain (or subdomain) appears in verified citations
 * mentioned   — brand named in prose without citation gravity or recommendation
 * absent      — neither name nor brand domain in answer/citations
 */
export function classifyVisibilityRung(input: VisibilityRungInput): VisibilityRung {
  const relationship = classifyEntityRelationship(input.answerText, input.brandName);
  const domainCited = input.citationDomains.some((domain) =>
    domainMatchesCompany(domain, input.companyDomain),
  );
  if (relationship === "recommended") return "recommended";
  if (domainCited) return "cited";
  if (input.brandMentioned) return "mentioned";
  return "absent";
}
