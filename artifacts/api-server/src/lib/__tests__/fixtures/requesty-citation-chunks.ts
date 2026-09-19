/**
 * Requesty / provider stream fixtures used to lock citation extraction.
 * These are structured metadata payloads only — not answer-prose URL lists.
 */

/** Requesty Chat Completions documented shape (docs.requesty.ai/features/web-search). */
export const requestyChatCompletionsWebSearchChunk = {
  choices: [
    {
      delta: {
        content: "Based on the search results...",
        web_search: {
          content: [{ url: "https://example.com/news", title: "London News" }],
        },
      },
    },
  ],
};

/** Requesty Responses-style annotation: url is on the annotation, not nested. */
export const requestyResponsesStyleAnnotationChunk = {
  choices: [
    {
      delta: {
        content: "Recent AI developments include...",
        annotations: [
          {
            type: "url_citation",
            url: "https://example.com/ai-news",
            title: "AI News Today",
            start_index: 0,
            end_index: 35,
          },
        ],
      },
    },
  ],
};

/** Historical nested url_citation payload (Perplexity / Anthropic via Requesty). */
export const nestedUrlCitationChunk = {
  choices: [
    {
      delta: {
        annotations: [
          { type: "url_citation", url_citation: { url: "https://www.example.com/a" } },
        ],
      },
    },
  ],
};

/**
 * Perplexity / xAI often attach citations on the chunk root of the terminal
 * chunk, including when delta is empty or choices is empty.
 */
export const perplexityRootCitationsChunk = {
  citations: ["https://www.bankrate.com/banking/savings/", "https://www.nerdwallet.com/best/banking/savings-accounts"],
  search_results: [
    { url: "https://www.bankrate.com/banking/savings/", title: "Savings rates" },
    { url: "https://www.nerdwallet.com/best/banking/savings-accounts", title: "Best savings" },
  ],
  choices: [{ delta: {}, finish_reason: "stop" }],
};

export const citationsOnEmptyChoicesChunk = {
  citations: ["https://docs.perplexity.ai/guides/citations"],
  choices: [],
};

/** Non-delta message payload some proxies emit on the last chunk. */
export const messageAnnotationsChunk = {
  choices: [
    {
      delta: {},
      message: {
        role: "assistant",
        content: "Here are the sources.",
        annotations: [
          { type: "url_citation", url_citation: { url: "https://www.ft.com/content/abc" } },
        ],
      },
    },
  ],
};

/** Gemini Vertex grounding metadata (snake_case and web.uri). */
export const geminiGroundingMetadataChunk = {
  choices: [
    {
      delta: {
        content: "Rates vary by provider.",
        grounding_metadata: {
          grounding_chunks: [
            { web: { uri: "https://www.moneyhelper.org.uk/savings", title: "MoneyHelper" } },
          ],
        },
        annotations: [{ type: "annotation" }],
      },
    },
  ],
};

/** Gemini web_search.content using uri instead of url. */
export const geminiWebSearchUriChunk = {
  choices: [
    {
      delta: {
        web_search: {
          content: [{ uri: "https://vertexaisearch.cloud.google.com/grounding/abc", title: "redirect" }],
        },
      },
    },
  ],
};

/** Anthropic Messages citation mapped onto a chat delta. */
export const anthropicWebSearchResultLocationChunk = {
  choices: [
    {
      delta: {
        content: "Recent AI developments include...",
        annotations: [
          {
            type: "web_search_result_location",
            url: "https://example.com/ai-news",
            title: "AI News Today",
            cited_text: "Recent breakthroughs in...",
          },
        ],
      },
    },
  ],
};

/** xAI dual shape: annotations + web_search, same URL twice. */
export const xaiDualShapeChunk = {
  choices: [
    {
      delta: {
        annotations: [{ type: "url_citation", url_citation: { url: "https://x.example/one" } }],
        web_search: { content: [{ url: "https://x.example/one" }, { url: "https://y.example/two" }] },
      },
    },
  ],
};

/** OpenAI-style array content parts with nested annotations. */
export const contentPartAnnotationsChunk = {
  choices: [
    {
      delta: {
        content: [
          {
            type: "text",
            text: "See the Bank of England.",
            annotations: [
              { type: "url_citation", url: "https://www.bankofengland.co.uk/statistics" },
            ],
          },
        ],
      },
    },
  ],
};

/** web_search.results instead of content (observed alias). */
export const webSearchResultsAliasChunk = {
  choices: [
    {
      delta: {
        web_search: {
          results: [{ url: "https://www.which.co.uk/money/savings", title: "Which? savings" }],
        },
      },
    },
  ],
};
