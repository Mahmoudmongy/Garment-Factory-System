# Setup (free Supabase account) — step by step

> Nothing here has been executed by the author (no Supabase project or network was available). Follow it on a **TEST project first** and report every error.

1. **Create a project** at supabase.com (a new empty project). Save the DB password. Check the current free-plan limits yourself (pausing on inactivity, storage, backups) before using it for real data.
2. **Disable public sign-ups:** Dashboard → Authentication → Providers/Sign In → turn OFF "Allow new users to sign up". Also set a minimum password length ≥ 8. (Users are created only by the admin Edge Function.)
3. Install the Supabase CLI, then in this folder: `supabase login` → `supabase link --project-ref <ref>`.
4. Apply the schema: `supabase db push` (runs `supabase/migrations/*.sql` in order). If any file fails, stop and send me the error text — do not edit the DB by hand.
5. **Create the first admin:** Dashboard → Authentication → Users → "Add user" (email `admin@factory.internal`, a strong password, auto-confirm). Copy its UUID, then in SQL Editor run:
   `select public.fn_bootstrap_first_admin('<UUID>', 'admin', 'المدير');`
6. Deploy the function: `supabase functions deploy admin-create-user` (the service key is injected by Supabase; do not paste it anywhere).
7. **Test the connection for real:** open `tools/connection-check.html` in a browser, paste the project URL and the **anon** key (NOT the service_role key), username `admin` + password. All lines must be green (✓). The page refuses a service_role key.
8. Run the DB tests: `supabase test db` (needs the local stack: `supabase start`). Then the integration tests (TEST project only): see header of `tests/integration/foundation.test.mjs`.
9. Static check (no DB needed): `python3 tools/static_sql_check.py`.

Secrets policy: `.env` files with keys are never committed; the browser only ever sees the project URL and the anon key.
