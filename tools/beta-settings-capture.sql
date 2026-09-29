-- Read-only snapshot of beta_settings for one contour (skill beta-config-02).
-- Run through tools/beta-settings-capture.sh. Prints key=value lines only:
-- public tier indexes and timestamps, never the admin Telegram ID.
SET default_transaction_read_only = on;

SELECT to_regclass('public.beta_settings') IS NOT NULL AS has_table,
       to_regclass('public.schema_migrations') IS NOT NULL AS has_migrations \gset

\if :has_migrations
SELECT 'migrations=' || coalesce(string_agg(name, ',' ORDER BY name), '') FROM schema_migrations;
\else
SELECT 'migrations=';
\endif

\if :has_table
SELECT 'table=present';
SELECT count(*) = 1 AS has_row FROM beta_settings WHERE id = 1 \gset
\if :has_row
SELECT kv.line
  FROM beta_settings b
 CROSS JOIN LATERAL (VALUES
   (1, 'db_beta_open=' || array_to_string(b.beta_open, ',')),
   (2, 'db_beta_open_normalized=' || array_to_string(
         ARRAY(SELECT DISTINCT x FROM unnest(b.beta_open) AS x WHERE x IS NOT NULL ORDER BY x), ',')),
   (3, 'changed_by_admin=' || CASE WHEN b.updated_by_telegram_user_id IS NULL THEN 'no' ELSE 'yes' END),
   (4, 'updated_at=' || to_char(b.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 ) AS kv(n, line)
 WHERE b.id = 1
 ORDER BY kv.n;
\else
SELECT 'row=absent';
\endif
\else
SELECT 'table=absent';
\endif
