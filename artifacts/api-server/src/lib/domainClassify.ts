import { db, domainRegistryTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type DomainType =
  | "corporate"
  | "competitor"
  | "editorial"
  | "directory"
  | "comparison"
  | "ugc"
  | "reference"
  | "institutional"
  | "you"
  | "other";

export type CitationMixBucket =
  | "owned"
  | "competitor"
  | "corporate"
  | "directory"
  | "comparison"
  | "editorial"
  | "ugc"
  | "institutional"
  | "other";

const UGC_DOMAINS = [
  "reddit.com",
  "quora.com",
  "stackoverflow.com",
  "stackexchange.com",
  "news.ycombinator.com",
  "medium.com",
  "dev.to",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "producthunt.com",
  "trustpilot.com",
];

const REFERENCE_DOMAINS = [
  "wikipedia.org",
  "wiktionary.org",
  "britannica.com",
  "github.com",
];

const EDITORIAL_DOMAINS = [
  "techcrunch.com",
  "theverge.com",
  "wired.com",
  "forbes.com",
  "nytimes.com",
  "bbc.com",
  "cnet.com",
  "zdnet.com",
  "searchengineland.com",
  "searchenginejournal.com",
  "hubspot.com",
  "semrush.com",
  "ahrefs.com",
  "moz.com",
  "backlinko.com",
  "startupmag.co.uk",
  "failory.com",
  "fool.com",
  "internationalbanker.com",
  "thebanker.com",
  "cnn.com",
  "cnbc.com",
  "finance.yahoo.com",
];

const DIRECTORY_DOMAINS = [
  "privateequitylist.com",
  "vc-mapping.gilion.com",
  "openvc.app",
  "visible.vc",
  "beauhurst.com",
  "seedtable.com",
  "incubatorlist.com",
  "roundfunded.com",
  "thatround.com",
  "vcbeast.com",
  "dealroom.co",
  "tracxn.com",
  "legal500.fr",
];

const COMPARISON_DOMAINS = [
  "wallethub.com",
  "moneysavingexpert.com",
  "bankrate.com",
  "thepointsguy.com",
  "creditcards.com",
  "creditkarma.com",
  "clearscore.com",
  "finder.com",
  "frequentmiler.com",
  "money.com.au",
  "moneysupermarket.com",
  "moneytothemasses.com",
  "nerdwallet.com",
  "onemileatatime.com",
  "savethestudent.org",
  "topconsumerreviews.com",
  "which.co.uk",
];

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").split("/")[0] ?? d;
  d = d.replace(/^www\./, "");
  return d;
}

function endsWithAny(domain: string, list: string[]): boolean {
  return list.some((s) => domain === s || domain.endsWith("." + s));
}

const MEDIA_PATH_PATTERN =
  /\/(?:article|articles|blog|blogs|guide|guides|insight|insights|learn|magazine|media|news|press|research|resources?|stories)(?:\/|$)/i;

function isMediaArticleUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return MEDIA_PATH_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

export function heuristicType(domain: string, brandDomain: string, rawUrl?: string): DomainType {
  if (domain === brandDomain || domain.endsWith("." + brandDomain)) {
    return "you";
  }
  if (
    domain.endsWith(".gov") ||
    domain.endsWith(".edu") ||
    domain.endsWith(".gov.uk") ||
    domain.endsWith(".ac.uk")
  ) {
    return "institutional";
  }
  if (endsWithAny(domain, UGC_DOMAINS)) return "ugc";
  if (endsWithAny(domain, REFERENCE_DOMAINS)) return "reference";
  if (endsWithAny(domain, DIRECTORY_DOMAINS)) return "directory";
  if (endsWithAny(domain, COMPARISON_DOMAINS)) return "comparison";
  if (endsWithAny(domain, EDITORIAL_DOMAINS)) return "editorial";
  if (isMediaArticleUrl(rawUrl)) return "editorial";
  return "other";
}

export function citationMixBucket(domainType: string): CitationMixBucket {
  if (domainType === "you") return "owned";
  if (domainType === "competitor") return "competitor";
  if (domainType === "corporate") return "other";
  if (domainType === "directory") return "directory";
  if (domainType === "comparison") return "comparison";
  if (domainType === "ugc") return "ugc";
  if (domainType === "institutional") return "institutional";
  if (domainType === "editorial" || domainType === "reference") return "editorial";
  return "other";
}

/**
 * Resolve a domain's type: use the registry when known, otherwise classify
 * heuristically and persist the new entry so future lookups are stable.
 */
export async function classifyAndRegister(
  rawDomain: string,
  company: { id: number; domain: string },
  rawUrl?: string,
): Promise<{
  domain: string;
  domainType: DomainType;
}> {
  const domain = normalizeDomain(rawDomain);
  const [existing] = await db
    .select()
    .from(domainRegistryTable)
    .where(
      and(
        eq(domainRegistryTable.companyId, company.id),
        eq(domainRegistryTable.domain, domain),
      ),
    );
  if (existing) {
    if (existing.domainType === "other") {
      const promotedType = heuristicType(domain, normalizeDomain(company.domain), rawUrl);
      if (promotedType !== "other") {
        await db
          .update(domainRegistryTable)
          .set({ domainType: promotedType, isOwned: promotedType === "you" })
          .where(eq(domainRegistryTable.id, existing.id));
        return { domain, domainType: promotedType };
      }
    }
    return { domain, domainType: existing.domainType as DomainType };
  }
  const domainType = heuristicType(domain, normalizeDomain(company.domain), rawUrl);
  await db
    .insert(domainRegistryTable)
    .values({ companyId: company.id, domain, domainType, isOwned: domainType === "you" })
    .onConflictDoNothing();
  return { domain, domainType };
}
