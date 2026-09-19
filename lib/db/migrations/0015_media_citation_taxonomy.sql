-- The monitored company's corporate site is already represented by "you"
-- (shown as Owned website). Retire the ambiguous separate Corporate bucket:
-- reclassify known publishers and article URLs as editorial (shown as Media &
-- Articles), then move remaining legacy fallback-corporate rows to unresolved.

CREATE TEMP TABLE _media_domains (
  base_domain text PRIMARY KEY
);

INSERT INTO _media_domains (base_domain) VALUES
  ('techcrunch.com'),
  ('theverge.com'),
  ('wired.com'),
  ('forbes.com'),
  ('nytimes.com'),
  ('bbc.com'),
  ('cnet.com'),
  ('zdnet.com'),
  ('searchengineland.com'),
  ('searchenginejournal.com'),
  ('hubspot.com'),
  ('semrush.com'),
  ('ahrefs.com'),
  ('moz.com'),
  ('backlinko.com'),
  ('startupmag.co.uk'),
  ('failory.com'),
  ('fool.com'),
  ('internationalbanker.com'),
  ('thebanker.com'),
  ('cnn.com'),
  ('cnbc.com'),
  ('finance.yahoo.com');

UPDATE domain_registry AS registry
SET domain_type = 'editorial'
WHERE registry.is_owned IS NOT TRUE
  AND registry.domain_type IN ('corporate', 'other')
  AND (
    EXISTS (
      SELECT 1
      FROM _media_domains AS media
      WHERE registry.domain = media.base_domain
         OR registry.domain LIKE '%.' || media.base_domain
    )
    OR EXISTS (
      SELECT 1
      FROM citations AS citation
      JOIN prompt_runs AS run ON run.id = citation.run_id
      JOIN prompts AS prompt ON prompt.id = run.prompt_id
      WHERE prompt.company_id = registry.company_id
        AND citation.domain = registry.domain
        AND lower(citation.url) ~ '/(article|articles|blog|blogs|guide|guides|insight|insights|learn|magazine|media|news|press|research|resource|resources|stories)(/|[?#]|$)'
    )
  );

UPDATE citations AS citation
SET domain_type = 'editorial'
WHERE citation.domain_type IN ('corporate', 'other')
  AND (
    EXISTS (
      SELECT 1
      FROM _media_domains AS media
      WHERE citation.domain = media.base_domain
         OR citation.domain LIKE '%.' || media.base_domain
    )
    OR lower(citation.url) ~ '/(article|articles|blog|blogs|guide|guides|insight|insights|learn|magazine|media|news|press|research|resource|resources|stories)(/|[?#]|$)'
  );

UPDATE domain_registry
SET domain_type = 'other'
WHERE is_owned IS NOT TRUE
  AND domain_type = 'corporate';

UPDATE citations
SET domain_type = 'other'
WHERE domain_type = 'corporate';

-- The company-scoped registry is authoritative for chart/source consistency.
UPDATE domain_registry
SET domain_type = 'you'
WHERE is_owned IS TRUE;

UPDATE citations AS citation
SET domain_type = registry.domain_type
FROM prompt_runs AS run
JOIN prompts AS prompt ON prompt.id = run.prompt_id
JOIN domain_registry AS registry
  ON registry.company_id = prompt.company_id
WHERE citation.run_id = run.id
  AND citation.domain = registry.domain
  AND registry.domain_type <> 'corporate';

-- Match runtime ownership precedence for both the root and its subdomains.
UPDATE citations AS citation
SET domain_type = 'you'
FROM prompt_runs AS run
JOIN prompts AS prompt ON prompt.id = run.prompt_id
JOIN domain_registry AS registry
  ON registry.company_id = prompt.company_id
 AND registry.is_owned IS TRUE
WHERE citation.run_id = run.id
  AND (
    citation.domain = registry.domain
    OR citation.domain LIKE '%.' || registry.domain
  );

DROP TABLE _media_domains;