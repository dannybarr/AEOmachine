/**
 * Curated research dataset: the state of AI/LLM citation behaviour and AEO.
 * Every figure is attributed to a published study. No estimates, no fabrication.
 * Compiled August 2026 from primary research by Pew Research Center, Ahrefs,
 * Similarweb, Graphite, Conductor, and xFunnel.
 */
export const AEO_RESEARCH = {
  updatedAt: "2026-08-24",
  kpis: [
    {
      label: "Monthly AI visits vs search (worldwide)",
      value: "56%",
      detail:
        "Worldwide monthly AI sessions are now 56% the size of traditional search (34% in the US) — 4-5x larger than earlier estimates.",
      source: "Graphite, Five Percent research",
      sourceUrl: "https://graphite.io/five-percent/research/ai-is-much-bigger-than-you-think",
      asOf: "July 2025",
    },
    {
      label: "CTR drop when an AI Overview appears",
      value: "-34.5%",
      detail:
        "Average click-through rate for the top-ranking page falls 34.5% when Google shows an AI Overview (300k keywords, GSC data, Mar 2024 vs Mar 2025).",
      source: "Ahrefs",
      sourceUrl: "https://ahrefs.com/blog/ai-overviews-reduce-clicks/",
      asOf: "March 2025",
    },
    {
      label: "Clicks on links inside AI summaries",
      value: "1%",
      detail:
        "Only 1% of Google searches with an AI summary resulted in a click on a source link inside the summary (68,879 real searches, 900 US adults).",
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
      asOf: "March 2025",
    },
    {
      label: "CMOs reporting positive AEO impact",
      value: "97%",
      detail:
        "97% of 250+ surveyed CMOs and digital leaders report a positive marketing-funnel impact from AEO; 94% plan to increase investment in 2026.",
      source: "Conductor, State of AEO/GEO 2026",
      sourceUrl: "https://www.conductor.com/academy/state-of-aeo-geo-report/",
      asOf: "2026",
    },
  ],
  ctrImpact: [
    {
      scenario: "Organic link, no AI summary",
      ctrPct: 15,
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
    },
    {
      scenario: "Organic link, AI summary present",
      ctrPct: 8,
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
    },
    {
      scenario: "Link cited inside the AI summary",
      ctrPct: 1,
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
    },
  ],
  citationsPerResponse: [
    {
      platform: "Perplexity",
      avgCitations: 6.61,
      source: "xFunnel (40k responses, 250k links)",
      sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose",
    },
    {
      platform: "Google Gemini",
      avgCitations: 6.1,
      source: "xFunnel (40k responses, 250k links)",
      sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose",
    },
    {
      platform: "ChatGPT",
      avgCitations: 2.62,
      source: "xFunnel (40k responses, 250k links)",
      sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose",
    },
  ],
  platformTrafficShare: [
    {
      platform: "ChatGPT",
      sharePct: 53,
      period: "May 2026 (down from ~76% in June 2025)",
      source: "Similarweb",
      sourceUrl: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
    },
    {
      platform: "Google Gemini",
      sharePct: 27.5,
      period: "May 2026 (up from <9% in June 2025)",
      source: "Similarweb",
      sourceUrl: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
    },
    {
      platform: "Claude",
      sharePct: 9,
      period: "May 2026 (up from ~2% in June 2025)",
      source: "Similarweb",
      sourceUrl: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
    },
    {
      platform: "Others",
      sharePct: 10.5,
      period: "May 2026",
      source: "Similarweb (remainder of generative AI web visits)",
      sourceUrl: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
    },
  ],
  sourceTypeShare: [
    {
      category: "Wikipedia + YouTube + Reddit",
      aiSharePct: 15,
      searchSharePct: 17,
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
    },
    {
      category: ".gov websites",
      aiSharePct: 6,
      searchSharePct: 2,
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
    },
    {
      category: "News websites",
      aiSharePct: 5,
      searchSharePct: 5,
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
    },
  ],
  domainAuthorityShare: [
    { bucket: "DA 80-100", sharePct: 31.53, source: "xFunnel / Moz DA", sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose" },
    { bucket: "DA 60-79", sharePct: 15.33, source: "xFunnel / Moz DA", sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose" },
    { bucket: "DA 40-59", sharePct: 26.32, source: "xFunnel / Moz DA", sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose" },
    { bucket: "DA 20-39", sharePct: 22.07, source: "xFunnel / Moz DA", sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose" },
    { bucket: "DA 0-19", sharePct: 4.76, source: "xFunnel / Moz DA", sourceUrl: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose" },
  ],
  adoption: [
    {
      label: "AI summary appearance rate on Google",
      value: "18%",
      detail:
        "18% of all Google searches in Pew's March 2025 panel produced an AI summary, rising to 60% for question-word queries.",
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
      asOf: "March 2025",
    },
    {
      label: "US search sessions showing an AI Overview",
      value: "43%+",
      detail: "More than 43% of US search sessions surfaced an AI Overview by 2026.",
      source: "Similarweb, 2026 Generative AI Landscape",
      sourceUrl: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
      asOf: "2026",
    },
    {
      label: "AI summaries citing three or more sources",
      value: "88%",
      detail:
        "88% of Google AI summaries cited three or more sources; only 1% cited a single source.",
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
      asOf: "March 2025",
    },
    {
      label: "US AI usage growth, year over year",
      value: "+300%",
      detail: "US AI usage grew 300% comparing December 2025 to December 2024; 45 billion monthly AI sessions worldwide.",
      source: "Graphite, Five Percent research",
      sourceUrl: "https://graphite.io/five-percent/research/ai-is-much-bigger-than-you-think",
      asOf: "December 2025",
    },
    {
      label: "ChatGPT share of worldwide search-related traffic",
      value: "20%",
      detail: "ChatGPT holds 20% of worldwide search-related traffic (12% US) vs Google's 71% worldwide, Q4 2025.",
      source: "Graphite, Five Percent research",
      sourceUrl: "https://graphite.io/five-percent/research/ai-is-much-bigger-than-you-think",
      asOf: "Q4 2025",
    },
    {
      label: "Generative AI monthly web visits",
      value: "9.5B",
      detail: "9.5 billion average monthly visits to generative AI sites (June 2025 - May 2026), up 70% year over year; 655M unique visitors.",
      source: "Similarweb",
      sourceUrl: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
      asOf: "May 2026",
    },
    {
      label: "Sessions ending after an AI summary",
      value: "26%",
      detail: "26% of users ended their browsing session after seeing an AI summary vs 16% with traditional results only.",
      source: "Pew Research Center",
      sourceUrl:
        "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
      asOf: "March 2025",
    },
    {
      label: "Position-1 CTR on AI Overview keywords",
      value: "0.073 to 0.026",
      detail: "Average position-1 CTR on keywords that trigger AI Overviews collapsed from 0.073 to 0.026 in twelve months.",
      source: "Ahrefs",
      sourceUrl: "https://ahrefs.com/blog/ai-overviews-reduce-clicks/",
      asOf: "March 2025",
    },
  ],
  investment: [
    {
      label: "Digital budget already allocated to AEO",
      value: "12%",
      detail: "Enterprises allocated an average 12% of digital budgets to AEO in 2025.",
      source: "Conductor, State of AEO/GEO 2026 (250+ CMOs/VPs)",
      sourceUrl: "https://www.conductor.com/academy/state-of-aeo-geo-report/",
      asOf: "2025",
    },
    {
      label: "LLM visitor conversion rate vs traditional channels",
      value: "2x",
      detail: "Visitors referred by LLMs convert at twice the rate of traditional channels, in one third of the sessions.",
      source: "Conductor, State of AEO/GEO 2026",
      sourceUrl: "https://www.conductor.com/academy/state-of-aeo-geo-report/",
      asOf: "2026",
    },
    {
      label: "Leaders increasing AEO investment in 2026",
      value: "94%",
      detail: "94% of surveyed digital leaders plan to increase AEO investment in 2026; 56% already made significant investments in 2025.",
      source: "Conductor, State of AEO/GEO 2026",
      sourceUrl: "https://www.conductor.com/academy/state-of-aeo-geo-report/",
      asOf: "2026",
    },
    {
      label: "AI conversions invisible to analytics",
      value: "0.9% vs 9%",
      detail:
        "Last-touch GA4 attributes only 0.9% of conversions to AI/LLMs while self-reported surveys say 9% — a 10x measurement gap hiding AI's real influence.",
      source: "Graphite, Five Percent research",
      sourceUrl: "https://graphite.io/five-percent/research/ai-is-much-bigger-than-you-think",
      asOf: "June 2026",
    },
  ],
  implications: [
    {
      title: "Being cited is the new ranking",
      detail:
        "With 88% of AI summaries citing three or more sources but only 1% of summary links clicked, brand visibility increasingly happens inside the answer, not after the click. If the model doesn't cite you, you don't exist in that conversation.",
      sources: [
        {
          name: "Pew Research Center, March 2025",
          url: "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
        },
      ],
    },
    {
      title: "Authority still wins, but the middle is open",
      detail:
        "31.5% of AI citations go to DA 80-100 domains, yet nearly half (48.4%) go to DA 20-59 — mid-authority sites win citations at a rate traditional search never allowed. Structured, answer-shaped content can outcite bigger brands.",
      sources: [
        {
          name: "xFunnel / Moz DA, February 2025",
          url: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose",
        },
      ],
    },
    {
      title: "Each engine behaves differently",
      detail:
        "Perplexity averages 6.6 citations per answer, ChatGPT only 2.6 — one open slot on ChatGPT is worth several on Perplexity. Platform-specific citation strategies beat one-size-fits-all SEO.",
      sources: [
        {
          name: "xFunnel, February 2025",
          url: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose",
        },
      ],
    },
    {
      title: "The measurement gap understates the shift",
      detail:
        "GA4 sees 0.9% of conversions from AI; users self-report 9%. Teams relying on last-touch analytics are underinvesting in the channel their buyers already use.",
      sources: [
        {
          name: "Graphite, Five Percent research, June 2026",
          url: "https://graphite.io/five-percent/research/ai-is-much-bigger-than-you-think",
        },
      ],
    },
    {
      title: "Late movers pay more",
      detail:
        "With 97% of CMOs seeing positive AEO impact, 94% raising budgets, and LLM visitors converting 2x, the arbitrage window — cheap citations in a low-competition channel — is closing.",
      sources: [
        {
          name: "Conductor, State of AEO/GEO 2026",
          url: "https://www.conductor.com/academy/state-of-aeo-geo-report/",
        },
      ],
    },
  ],
  sources: [
    {
      name: "Google users are less likely to click on links when an AI summary appears",
      publisher: "Pew Research Center",
      url: "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/",
      methodology: "68,879 unique Google searches from 900 US adults (KnowledgePanel), March 2025",
      date: "July 2025",
    },
    {
      name: "AI Overviews Reduce Clicks by 34.5%",
      publisher: "Ahrefs",
      url: "https://ahrefs.com/blog/ai-overviews-reduce-clicks/",
      methodology: "300,000 informational keywords, Google Search Console data, March 2024 vs March 2025",
      date: "2025",
    },
    {
      name: "AI Search Stats 2026: Market Share, Referral, and Citation Data",
      publisher: "Similarweb",
      url: "https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/",
      methodology: "Similarweb worldwide traffic panel, June 2025 - May 2026",
      date: "July 2026",
    },
    {
      name: "AI Is Much Bigger Than You Think",
      publisher: "Graphite (Five Percent research)",
      url: "https://graphite.io/five-percent/research/ai-is-much-bigger-than-you-think",
      methodology: "Traffic panel analysis plus ~1M deidentified ChatGPT messages (with OpenAI usage research)",
      date: "2026",
    },
    {
      name: "The State of AEO/GEO in 2026: CMO Investment Report",
      publisher: "Conductor",
      url: "https://www.conductor.com/academy/state-of-aeo-geo-report/",
      methodology: "Survey of 250+ enterprise CMOs, VPs, and senior digital leaders",
      date: "April 2026",
    },
    {
      name: "What sources do AI Search Engines cite?",
      publisher: "xFunnel",
      url: "https://www.xfunnel.ai/blog/what-sources-do-ai-search-engines-choose",
      methodology: "40,000 AI search responses, 250,000 unique outbound links; Moz domain authority",
      date: "February 2025",
    },
  ],
};
