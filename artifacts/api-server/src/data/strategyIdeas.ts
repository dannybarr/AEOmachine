/**
 * The Strategy Ideas library: reusable, client-agnostic AEO plays generalized
 * from Graphite's 5-step playbook workbook (onsite + offsite strategy tabs).
 * Seeded once into the strategy_ideas table on first access.
 */
export interface StrategyIdeaSeed {
  title: string;
  category: "on_page" | "off_page";
  playType: string;
  description: string;
  rationale: string;
  priority: "P0" | "P1" | "P2";
}

export const STRATEGY_IDEA_SEEDS: StrategyIdeaSeed[] = [
  // ─── Onsite plays (Step 3: build on your own domain) ───
  {
    title: "Pillar hub for your highest-value money topic",
    category: "on_page",
    playType: "Landing Page / Pillar Hub",
    description:
      "One authority guide that becomes the central node for a whole topic cluster. Open with a ~100-word answer summary, then cover benchmarks, mechanics, timelines and FAQs. Every supporting article links back to it.",
    rationale:
      "AI engines reward a clearly structured authority page that internal links corroborate. The hub concentrates citation equity instead of splitting it across scattered posts.",
    priority: "P0",
  },
  {
    title: "Comparison landing page with answer-first table + decision tree",
    category: "on_page",
    playType: "Comparison Landing Page",
    description:
      "Target a head-to-head buyer decision ('X vs Y'). Lead with an answer-first comparison table across concrete dimensions, then a decision tree: 'Choose X if… / choose Y if…'.",
    rationale:
      "Tables and explicit decision rules are highly retrievable structures — AI answers lift them almost verbatim, which earns the citation.",
    priority: "P0",
  },
  {
    title: "Interactive calculator for a money topic",
    category: "on_page",
    playType: "Interactive Tool / Calculator",
    description:
      "Build a genuine calculator around a quantitative buyer question, with common benchmarks explained around the result.",
    rationale:
      "Tools are much harder for generic publishers to replicate and generate repeat traffic, backlinks and branded citations long after launch.",
    priority: "P0",
  },
  {
    title: "Answer page targeting one exact buyer question",
    category: "on_page",
    playType: "Help Center / Answer Page",
    description:
      "Answer the exact question in the first two sentences, then expand into methods, worked examples and honest caveats.",
    rationale:
      "Answer-first structure matches how engines assemble responses; short authoritative pages can out-cite much larger sites for a single question.",
    priority: "P0",
  },
  {
    title: "Curated 'best X for Y' list page with structured fields",
    category: "on_page",
    playType: "Landing Page / Rankings",
    description:
      "A flagship list page for a category buyers ask AI to shortlist. Include structured fields per entry (specs, pricing, fit, how to engage) and disclose objectively where your own brand fits.",
    rationale:
      "Ranked, field-structured lists are the page type AI most often cites for 'best/top' prompts — and objectivity is what keeps the citation.",
    priority: "P0",
  },
  {
    title: "Niche segment database page (long-tail whitespace)",
    category: "on_page",
    playType: "Landing Page / Database",
    description:
      "A searchable database targeting an underserved niche segment where incumbents are weak. Real fields, not prose.",
    rationale:
      "Long-tail segments have thin competition; a structured database becomes the definitive retrievable source for that niche.",
    priority: "P1",
  },
  {
    title: "Verified 'open access' database with freshness labels",
    category: "on_page",
    playType: "Landing Page / Database",
    description:
      "A database answering a high-intent access question (who accepts cold applications, who is open now). Verify each entry and show a visible 'last verified' date.",
    rationale:
      "Freshness signals create trust and AEO defensibility — engines prefer sources that demonstrably keep data current.",
    priority: "P0",
  },
  {
    title: "Insider process tutorial from practitioner knowledge",
    category: "on_page",
    playType: "Tutorial",
    description:
      "Turn insider knowledge into concrete steps with strong vs weak examples (e.g. how to get a warm introduction, how to run a process).",
    rationale:
      "Practitioner-authored process content carries authority generic content farms can't fake, and step lists are highly quotable.",
    priority: "P1",
  },
  {
    title: "Repeatable framework tutorial with scoring model",
    category: "on_page",
    playType: "Tutorial",
    description:
      "Publish a named, repeatable framework with explicit funnel numbers and scoring factors (e.g. 100 candidates → 40 qualified → 10 high-conviction).",
    rationale:
      "Named frameworks with concrete numbers get referenced and reused — AI answers cite the framework and its source.",
    priority: "P1",
  },
  {
    title: "Head-to-head brand comparison for citation whitespace",
    category: "on_page",
    playType: "Comparison Article",
    description:
      "Compare two brands your buyers weigh up where no definitive source exists yet. Use measurable dimensions, and be careful when the two aren't perfectly comparable.",
    rationale:
      "Citation whitespace means the first rigorous comparison becomes the default retrieved source for that prompt.",
    priority: "P1",
  },
  {
    title: "Definitional help-center page (answer → detail → FAQ)",
    category: "on_page",
    playType: "Help Center",
    description:
      "Own a definitional query with a short authoritative page: definition first, then responsibilities/mechanics, then FAQs.",
    rationale:
      "Well-structured definitional pages outrank larger sites for 'what is X' prompts because engines want the cleanest extractable answer.",
    priority: "P2",
  },
  {
    title: "Instrument/terms comparison table",
    category: "on_page",
    playType: "Help Center / Comparison",
    description:
      "Compare two technical instruments or contract structures in a table: mechanics, costs, risks, when each applies.",
    rationale:
      "Technical comparison tables answer high-stakes buyer questions precisely — the structure is what gets cited.",
    priority: "P1",
  },
  {
    title: "Plain-language jargon explainer ('explained simply')",
    category: "on_page",
    playType: "Help Center",
    description:
      "Explain one piece of industry jargon in plain language with a worked example, titled the way buyers actually phrase it.",
    rationale:
      "Exact-intent naming ('X explained simply') aligns the page with generative search phrasing and wins the citation.",
    priority: "P1",
  },
  {
    title: "Honest downside / objection page",
    category: "on_page",
    playType: "Blog / Opinion",
    description:
      "Address the uncomfortable question directly (what happens if it fails, should you do this at all) with balanced, credible guidance.",
    rationale:
      "Honesty on downside questions is rare from vendors; engines reward the balanced take and it builds durable brand trust.",
    priority: "P1",
  },
  {
    title: "Proprietary benchmark data page",
    category: "on_page",
    playType: "Landing Page / Data Page",
    description:
      "Publish proprietary benchmarks for a money topic (sizes, rates, timelines) from your own data, refreshed on a stated cadence.",
    rationale:
      "Original numbers are the most citable asset on the internet — everyone who references the stat references you.",
    priority: "P0",
  },
  {
    title: "Original data index / recurring report",
    category: "on_page",
    playType: "Original Data / Quarterly Report",
    description:
      "A named recurring index or quarterly report built from your proprietary data, with a stable URL that accretes authority each release.",
    rationale:
      "Recurring named reports become the default source engines retrieve for market-state questions in your category.",
    priority: "P0",
  },
  {
    title: "Buyer knowledge base / resource hub",
    category: "on_page",
    playType: "Resource Hub",
    description:
      "A curated hub organizing all your answer pages, guides and tools by buyer journey stage.",
    rationale:
      "The hub structure clarifies your site's topical coverage to crawlers and concentrates internal-link authority.",
    priority: "P1",
  },
  {
    title: "Glossary / entity pages for category terms",
    category: "on_page",
    playType: "Glossary / Entity Pages",
    description:
      "One short page per key term in your category, interlinked, each answering the definition immediately.",
    rationale:
      "Entity pages strengthen machine understanding of your topical authority and capture long-tail definitional prompts.",
    priority: "P2",
  },
  {
    title: "Process timeline tutorial ('how long does X take')",
    category: "on_page",
    playType: "Tutorial",
    description:
      "Map out a realistic stage-by-stage timeline for a process buyers plan around, with ranges and the factors that stretch them.",
    rationale:
      "Timeline questions are constant top-of-funnel prompts; concrete stage ranges are exactly what engines extract.",
    priority: "P2",
  },
  {
    title: "Market landscape research page by segment",
    category: "on_page",
    playType: "Research / Rankings",
    description:
      "A structured landscape overview of your market's players by stage, sector or geography, refreshed on a schedule.",
    rationale:
      "Landscape pages capture broad mapping prompts and position you as the category cartographer.",
    priority: "P2",
  },
  // ─── Offsite plays (Step 4: earn mentions off your domain) ───
  {
    title: "Data PR: exclusive proprietary stats to a tier-1 publication",
    category: "off_page",
    playType: "Earned Media – Data PR",
    description:
      "Pitch a tier-1 outlet an exclusive story built on your proprietary data about a money topic buyers care about.",
    rationale:
      "External mentions are heavily cited by AI, and tier-1 domains carry the most corroborative authority. Data exclusives are the reliable way in.",
    priority: "P0",
  },
  {
    title: "Contributed expert article in trade media",
    category: "off_page",
    playType: "Earned Media – Founder Education",
    description:
      "Author an educational piece answering one money question in a respected trade publication, under your expert's byline.",
    rationale:
      "The answer lives on a domain engines already trust, with your brand attached as the expert source.",
    priority: "P0",
  },
  {
    title: "Co-branded external guide with a complementary platform",
    category: "off_page",
    playType: "External Expert Guide",
    description:
      "Partner with a complementary (non-competing) platform to co-author the definitive guide on a shared money topic, hosted on their domain.",
    rationale:
      "Third-party hosting creates independent corroboration; both brands' audiences and link graphs feed the same asset.",
    priority: "P0",
  },
  {
    title: "External data partnership benchmark",
    category: "off_page",
    playType: "External Data Partnership",
    description:
      "Combine your data with a data-rich partner's to publish a joint benchmark neither could produce alone.",
    rationale:
      "Joint benchmarks get cited by both ecosystems and are nearly impossible for competitors to replicate.",
    priority: "P0",
  },
  {
    title: "Podcast appearance built around target questions",
    category: "off_page",
    playType: "Podcast",
    description:
      "Book podcast episodes structured around your target money questions so the published transcript answers them verbatim.",
    rationale:
      "Podcast transcripts are retrievable text on external domains — a spoken answer becomes a citable written one.",
    priority: "P0",
  },
  {
    title: "Recurring data column / barometer in a niche publication",
    category: "off_page",
    playType: "Earned Media – Commentary",
    description:
      "Pitch a recurring monthly column or 'barometer' feature built on your data in a niche industry outlet.",
    rationale:
      "Recurrence compounds: every issue is a fresh external mention tied to your brand and topic cluster.",
    priority: "P1",
  },
  {
    title: "Media list collaboration on an access topic",
    category: "off_page",
    playType: "Earned Media – Research Collaboration",
    description:
      "Co-produce a list article with a publication on an access question buyers ask (who's open, who accepts cold approaches), with your research as the backbone.",
    rationale:
      "List formats dominate citations for shortlist prompts; the collaboration puts your name inside the winning format.",
    priority: "P1",
  },
  {
    title: "Expert contributor post on the community's home platform",
    category: "off_page",
    playType: "External Blog / Contributor",
    description:
      "Publish practitioner guidance directly on the platform where your buyers congregate (community blog, contributor network).",
    rationale:
      "Platform-native content is retrieved for that community's questions and reads as peer advice, not marketing.",
    priority: "P1",
  },
  {
    title: "Weekly LinkedIn answer series (company page)",
    category: "off_page",
    playType: "Professional Social",
    description:
      "A weekly company-page series answering one money question with real numbers each time.",
    rationale:
      "Professional-social posts are increasingly retrieved surfaces, and the cadence builds a queryable public answer archive.",
    priority: "P0",
  },
  {
    title: "Executive personal-brand answer cadence",
    category: "off_page",
    playType: "Professional Social – Personal Brands",
    description:
      "Executives each answer one buyer money question per week from their personal accounts, in their own voice.",
    rationale:
      "Personal accounts reach further than brand pages and add independent-looking corroboration across multiple authors.",
    priority: "P0",
  },
  {
    title: "Long-form video series answering money topics",
    category: "off_page",
    playType: "Long-Form Video",
    description:
      "An episodic YouTube series where each episode answers one target question, with descriptions and chapters mirroring the exact phrasing.",
    rationale:
      "Video titles, descriptions and auto-transcripts are indexed and cited; a series builds a durable authority surface.",
    priority: "P1",
  },
  {
    title: "Short-form video: 60-second exact-question answers",
    category: "off_page",
    playType: "Short-Form Video",
    description:
      "Shorts/TikTok/Reels where the speaker says the exact question aloud and answers it in under a minute.",
    rationale:
      "Spoken exact-question phrasing lands in transcripts and captions — retrievable text, not just brand awareness.",
    priority: "P1",
  },
  {
    title: "Reddit AMA on your money topics",
    category: "off_page",
    playType: "Community / UGC",
    description:
      "Host an AMA in the subreddit where your buyers ask questions, answering candidly with real numbers.",
    rationale:
      "Reddit is one of the most-cited UGC domains in AI answers; a good AMA seeds dozens of retrievable threads.",
    priority: "P1",
  },
  {
    title: "Hacker News data-asset launch",
    category: "off_page",
    playType: "Community / UGC",
    description:
      "Release a genuinely useful public dataset or methodology and launch it as a Show/Ask post.",
    rationale:
      "Technical communities respond to useful artifacts, not marketing — and the resulting thread plus dataset both get cited.",
    priority: "P1",
  },
  {
    title: "Guest analysis in a respected newsletter",
    category: "off_page",
    playType: "Newsletter / External Creator",
    description:
      "Contribute a contrarian, data-backed analysis to a respected industry newsletter under your expert's name.",
    rationale:
      "Newsletter archives live on trusted domains and get cited for opinionated 'what do experts think' prompts.",
    priority: "P1",
  },
  {
    title: "Partner essay on an external education platform",
    category: "off_page",
    playType: "External Comparison / Education",
    description:
      "Publish a decision-framework essay on an external platform (e.g. Medium) for subjective buyer questions. Canonicalize carefully if it overlaps onsite content.",
    rationale:
      "External platforms surface for subjective questions where official sites don't; the framework travels with your byline.",
    priority: "P1",
  },
  {
    title: "Co-authored professional-partner resource",
    category: "off_page",
    playType: "Affiliate / Professional Partner",
    description:
      "Pair your commercial perspective with an independent professional's (legal, financial) in a co-authored resource on their domain.",
    rationale:
      "Cross-professional co-authorship creates stronger corroboration than either party publishing alone.",
    priority: "P0",
  },
  {
    title: "Partner-hosted calculator with expert commentary",
    category: "off_page",
    playType: "Affiliate / Finance Partner",
    description:
      "Embed your expert commentary in a useful tool hosted on a partner's domain.",
    rationale:
      "Useful tools earn persistent discovery, links and citations beyond launch week — and your commentary rides along.",
    priority: "P1",
  },
  {
    title: "Masterclass in a partner community's resource library",
    category: "off_page",
    playType: "Accelerator / Community Partnership",
    description:
      "Run a masterclass for a partner community, requiring the recording, slides and transcript to remain permanently hosted on their domain.",
    rationale:
      "The permanent external artifact is what matters for AEO — a transient live webinar leaves nothing to retrieve.",
    priority: "P0",
  },
  {
    title: "Academic research collaboration",
    category: "off_page",
    playType: "University / Academic Collaboration",
    description:
      "Supply anonymized market data to an academic partner who contributes methodology; publish on the university domain. Don't try to control findings.",
    rationale:
      "Academic domains provide extremely strong corroborative authority; independence is the feature, not the bug.",
    priority: "P1",
  },
  {
    title: "Rapid-response expert quote desk for journalists",
    category: "off_page",
    playType: "PR / Expert Quotation Engine",
    description:
      "Maintain a bank of approved 50–100-word quotable answers and current data points; respond fast when journalists need a view.",
    rationale:
      "Dozens of legitimate micro-mentions across news domains beat one big feature for citation coverage.",
    priority: "P0",
  },
  {
    title: "Customer/partner UGC enablement (never scripted)",
    category: "off_page",
    playType: "Portfolio / Customer UGC",
    description:
      "Enable customers or portfolio companies to tell their own story on their own channels — offer data and context, never dictate claims.",
    rationale:
      "Independent proof is the strongest evidence class; authenticity is precisely what makes it citable.",
    priority: "P1",
  },
  {
    title: "Industry database profile hygiene",
    category: "off_page",
    playType: "Database / Profile Optimization",
    description:
      "Complete and align your entity data across the industry databases machines read (categories, sizes, locations, key facts).",
    rationale:
      "Entity conflicts weaken retrieval confidence; consistent machine-readable data is table-stakes hygiene for AEO.",
    priority: "P0",
  },
  {
    title: "Directory profile verification with consistent language",
    category: "off_page",
    playType: "Directory / Profile",
    description:
      "Verify your profiles on the directories buyers use to shortlist, using exactly consistent language everywhere. Update quarterly.",
    rationale:
      "Directories feed shortlist prompts directly; inconsistent language across profiles splits your entity signal.",
    priority: "P0",
  },
  {
    title: "Wikipedia / Wikidata entity governance",
    category: "off_page",
    playType: "Wikipedia / Wikidata",
    description:
      "Where independently notable, correct factual inaccuracies transparently under conflict-of-interest rules. Never create promotional material.",
    rationale:
      "Entity consistency helps machine understanding, but credibility must come first — governance only, not marketing.",
    priority: "P2",
  },
  {
    title: "Annual flagship research event → 20+ external assets",
    category: "off_page",
    playType: "Flagship Event / Media Asset",
    description:
      "Turn one annual research launch into 20+ external artifacts: journalist briefing, report, podcast interviews, video presentation, partner summaries, social clips.",
    rationale:
      "One flagship event fans out into citations across every channel at once and becomes your recurring authority moment.",
    priority: "P0",
  },
];
