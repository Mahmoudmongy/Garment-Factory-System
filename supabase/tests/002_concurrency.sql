-- 002_concurrency.sql — one invocation per parallel session, driven by tools/run_concurrency_local.sh.
-- The runner passes -v kind=... -v n=... and reads back the single "RESULT <kind> <n> <outcome>" line.
-- All logic lives in tests.cc_run() because psql client variables cannot be interpolated
-- inside a DO block body.
\set ON_ERROR_STOP on

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select 'RESULT ' || :'kind' || ' ' || :'n' || ' ' || tests.cc_run(:'kind', :'n');
