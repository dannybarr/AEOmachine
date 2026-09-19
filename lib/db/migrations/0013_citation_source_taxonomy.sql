-- Enrich the source-role taxonomy for domains already observed before the
-- directory/comparison categories existed. Owned, competitor, UGC, and
-- reference overrides are deliberately preserved.

UPDATE domain_registry
SET domain_type = CASE
  WHEN domain = 'vertexaisearch.cloud.google.com' THEN 'other'
  WHEN domain IN (
    'privateequitylist.com', 'vc-mapping.gilion.com', 'openvc.app',
    'visible.vc', 'beauhurst.com', 'seedtable.com', 'incubatorlist.com',
    'roundfunded.com', 'thatround.com', 'vcbeast.com', 'dealroom.co',
    'tracxn.com', 'legal500.fr', 'my.legal500.fr'
  ) THEN 'directory'
  WHEN domain IN (
    'wallethub.com', 'moneysavingexpert.com', 'bankrate.com',
    'thepointsguy.com', 'creditcards.com', 'creditkarma.com',
    'clearscore.com', 'finder.com', 'frequentmiler.com', 'money.com.au',
    'moneysupermarket.com', 'moneytothemasses.com', 'nerdwallet.com',
    'onemileatatime.com', 'savethestudent.org', 'topconsumerreviews.com',
    'which.co.uk'
  ) THEN 'comparison'
  WHEN domain IN (
    'startupmag.co.uk', 'failory.com', 'fool.com',
    'internationalbanker.com', 'thebanker.com', 'cnn.com', 'cnbc.com',
    'finance.yahoo.com'
  ) THEN 'editorial'
  WHEN domain = 'nssif.gov.uk' THEN 'institutional'
  ELSE domain_type
END
WHERE domain_type NOT IN ('you', 'competitor', 'ugc', 'reference');

UPDATE citations
SET domain_type = CASE
  WHEN domain = 'vertexaisearch.cloud.google.com' THEN 'other'
  WHEN domain IN (
    'privateequitylist.com', 'vc-mapping.gilion.com', 'openvc.app',
    'visible.vc', 'beauhurst.com', 'seedtable.com', 'incubatorlist.com',
    'roundfunded.com', 'thatround.com', 'vcbeast.com', 'dealroom.co',
    'tracxn.com', 'legal500.fr', 'my.legal500.fr'
  ) THEN 'directory'
  WHEN domain IN (
    'wallethub.com', 'moneysavingexpert.com', 'bankrate.com',
    'thepointsguy.com', 'creditcards.com', 'creditkarma.com',
    'clearscore.com', 'finder.com', 'frequentmiler.com', 'money.com.au',
    'moneysupermarket.com', 'moneytothemasses.com', 'nerdwallet.com',
    'onemileatatime.com', 'savethestudent.org', 'topconsumerreviews.com',
    'which.co.uk'
  ) THEN 'comparison'
  WHEN domain IN (
    'startupmag.co.uk', 'failory.com', 'fool.com',
    'internationalbanker.com', 'thebanker.com', 'cnn.com', 'cnbc.com',
    'finance.yahoo.com'
  ) THEN 'editorial'
  WHEN domain = 'nssif.gov.uk' THEN 'institutional'
  ELSE domain_type
END
WHERE domain_type NOT IN ('you', 'competitor', 'ugc', 'reference');

-- Bring historical suffix-based classifications into line with the runtime
-- classifier. The former blanket `.org` rule was too broad; genuine
-- institutional suffixes are now explicit.
UPDATE domain_registry
SET domain_type = 'institutional'
WHERE is_owned IS NOT TRUE
  AND domain_type NOT IN ('you', 'competitor', 'ugc', 'reference')
  AND (
    domain LIKE '%.gov'
    OR domain LIKE '%.edu'
    OR domain LIKE '%.gov.uk'
    OR domain LIKE '%.ac.uk'
  );

UPDATE citations
SET domain_type = 'institutional'
WHERE domain_type NOT IN ('you', 'competitor', 'ugc', 'reference')
  AND (
    domain LIKE '%.gov'
    OR domain LIKE '%.edu'
    OR domain LIKE '%.gov.uk'
    OR domain LIKE '%.ac.uk'
  );

UPDATE domain_registry
SET domain_type = 'corporate'
WHERE is_owned IS NOT TRUE
  AND domain_type = 'institutional'
  AND domain LIKE '%.org';

UPDATE citations
SET domain_type = 'corporate'
WHERE domain_type = 'institutional'
  AND domain LIKE '%.org';

-- Runtime matching is suffix-aware, so historical subdomains must resolve to
-- the same role as their registered base domain.
CREATE TEMP TABLE _citation_taxonomy_map (
  base_domain text PRIMARY KEY,
  domain_type text NOT NULL
);

INSERT INTO _citation_taxonomy_map (base_domain, domain_type) VALUES
  ('privateequitylist.com', 'directory'),
  ('vc-mapping.gilion.com', 'directory'),
  ('openvc.app', 'directory'),
  ('visible.vc', 'directory'),
  ('beauhurst.com', 'directory'),
  ('seedtable.com', 'directory'),
  ('incubatorlist.com', 'directory'),
  ('roundfunded.com', 'directory'),
  ('thatround.com', 'directory'),
  ('vcbeast.com', 'directory'),
  ('dealroom.co', 'directory'),
  ('tracxn.com', 'directory'),
  ('legal500.fr', 'directory'),
  ('wallethub.com', 'comparison'),
  ('moneysavingexpert.com', 'comparison'),
  ('bankrate.com', 'comparison'),
  ('thepointsguy.com', 'comparison'),
  ('creditcards.com', 'comparison'),
  ('creditkarma.com', 'comparison'),
  ('clearscore.com', 'comparison'),
  ('finder.com', 'comparison'),
  ('frequentmiler.com', 'comparison'),
  ('money.com.au', 'comparison'),
  ('moneysupermarket.com', 'comparison'),
  ('moneytothemasses.com', 'comparison'),
  ('nerdwallet.com', 'comparison'),
  ('onemileatatime.com', 'comparison'),
  ('savethestudent.org', 'comparison'),
  ('topconsumerreviews.com', 'comparison'),
  ('which.co.uk', 'comparison'),
  ('startupmag.co.uk', 'editorial'),
  ('failory.com', 'editorial'),
  ('fool.com', 'editorial'),
  ('internationalbanker.com', 'editorial'),
  ('thebanker.com', 'editorial'),
  ('cnn.com', 'editorial'),
  ('cnbc.com', 'editorial'),
  ('finance.yahoo.com', 'editorial');

UPDATE domain_registry AS registry
SET domain_type = taxonomy.domain_type
FROM _citation_taxonomy_map AS taxonomy
WHERE (
    registry.domain = taxonomy.base_domain
    OR registry.domain LIKE '%.' || taxonomy.base_domain
  )
  AND registry.is_owned IS NOT TRUE
  AND registry.domain_type NOT IN ('you', 'competitor', 'ugc', 'reference');

UPDATE citations AS citation
SET domain_type = taxonomy.domain_type
FROM _citation_taxonomy_map AS taxonomy
WHERE (
    citation.domain = taxonomy.base_domain
    OR citation.domain LIKE '%.' || taxonomy.base_domain
  )
  AND citation.domain_type NOT IN ('you', 'competitor', 'ugc', 'reference')
  AND NOT EXISTS (
    SELECT 1
    FROM prompt_runs AS run
    JOIN prompts AS prompt ON prompt.id = run.prompt_id
    JOIN domain_registry AS registry
      ON registry.company_id = prompt.company_id
      AND registry.domain = citation.domain
      AND registry.is_owned IS TRUE
    WHERE run.id = citation.run_id
  );

DROP TABLE _citation_taxonomy_map;

-- Ownership is company-specific and authoritative. Restore it last so no
-- generic source-role rule can demote an owned domain.
UPDATE domain_registry
SET domain_type = 'you'
WHERE is_owned IS TRUE;

UPDATE citations AS citation
SET domain_type = 'you'
FROM prompt_runs AS run
JOIN prompts AS prompt ON prompt.id = run.prompt_id
JOIN domain_registry AS registry
  ON registry.company_id = prompt.company_id
  AND registry.is_owned IS TRUE
WHERE citation.run_id = run.id
  AND citation.domain = registry.domain;