-- 20261019000002_identity_access.sql
-- Employee / Profile(User) / Role / Permission are separate entities.
-- STATUS: NOT EXECUTED (no database available when authored).

create table public.employees (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique default public.fn_next_code('EMP'),
  full_name        text not null check (length(btrim(full_name)) > 0),
  job_title        text,
  department       text,
  employment_type  text,                       -- OPEN BUSINESS DECISION: allowed values
  phone            text not null check (phone ~ '^\+?[0-9]{8,15}$'),
  phone2           text check (phone2 is null or phone2 ~ '^\+?[0-9]{8,15}$'),
  start_date       date,
  status           text not null default 'active' check (status in ('active','inactive','terminated')),
  id_document_path text,                       -- path inside private bucket employee-documents
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
create trigger set_updated_at before update on public.employees
  for each row execute function public.trg_set_updated_at();

-- Effective-dated pay terms: history is never overwritten.
create table public.employee_pay_terms (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.employees(id),
  pay_basis            text not null check (pay_basis in ('piece','daily','weekly','monthly','hybrid')),
  salary_amount        numeric(14,2) not null default 0 check (salary_amount >= 0),
  salary_frequency     text check (salary_frequency in ('daily','weekly','monthly')),
  allocation_frequency text check (allocation_frequency in ('daily','weekly','monthly')),
  effective_from       date not null,
  effective_to         date,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  unique (employee_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
create or replace function public.trg_pay_terms_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.effective_to is not null
       or (old.employee_id, old.pay_basis, old.salary_amount, old.salary_frequency, old.allocation_frequency, old.effective_from)
          is distinct from
          (new.employee_id, new.pay_basis, new.salary_amount, new.salary_frequency, new.allocation_frequency, new.effective_from) then
      raise exception 'pay terms history is immutable (only closing an open term is allowed)' using errcode = 'F0006';
    end if;
    return new;
  end if;
  if exists (select 1 from public.employee_pay_terms t
             where t.employee_id = new.employee_id
               and daterange(t.effective_from, coalesce(t.effective_to, 'infinity'::date), '[]')
                && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')) then
    raise exception 'overlapping pay terms for employee' using errcode = 'F0007';
  end if;
  return new;
end $$;
create trigger pay_terms_guard before insert or update on public.employee_pay_terms
  for each row execute function public.trg_pay_terms_guard();
create trigger pay_terms_no_delete before delete on public.employee_pay_terms
  for each row execute function public.trg_forbid_mutation();

-- Login identity (1 row per Supabase auth user). Not every employee needs one.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete restrict,
  employee_id  uuid unique references public.employees(id),
  username     text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  display_name text,
  is_active    boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on public.profiles
  for each row execute function public.trg_set_updated_at();

create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[a-z_]+$'),
  name_ar      text not null,
  description  text,
  is_superuser boolean not null default false,
  is_system    boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on public.roles
  for each row execute function public.trg_set_updated_at();

-- Extensible permission catalog (dotted keys).
create table public.permissions (
  key            text primary key check (key ~ '^[a-z]+(\.[a-z_]+)+$'),
  module         text not null,
  description_ar text,
  is_active      boolean not null default true
);

create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key),
  primary key (role_id, permission_key)
);

create table public.user_roles (
  profile_id uuid not null references public.profiles(id),
  role_id    uuid not null references public.roles(id),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (profile_id, role_id)
);

-- User-specific override: effect = grant | deny  (deny wins over role grants).
create table public.user_permissions (
  profile_id     uuid not null references public.profiles(id),
  permission_key text not null references public.permissions(key),
  effect         text not null check (effect in ('grant','deny')),
  granted_by     uuid,
  granted_at     timestamptz not null default now(),
  primary key (profile_id, permission_key)
);

-- ------------------------------------------------------------ authorization
create or replace function public.fn_is_active_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

create or replace function public.fn_is_superuser() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id
    join public.roles r on r.id = ur.role_id
    where p.id = auth.uid() and p.is_active and r.is_superuser and r.is_active)
$$;

-- effective permission = active user AND key exists/active AND
--   (superuser OR ((role grants OR user grant) AND NOT user deny))
create or replace function public.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.fn_is_active_user()
    and exists (select 1 from public.permissions where key = p_key and is_active)
    and ( public.fn_is_superuser()
          or ( ( exists (select 1 from public.user_roles ur
                         join public.roles r on r.id = ur.role_id and r.is_active
                         join public.role_permissions rp on rp.role_id = ur.role_id
                         where ur.profile_id = auth.uid() and rp.permission_key = p_key)
                 or exists (select 1 from public.user_permissions up
                            where up.profile_id = auth.uid() and up.permission_key = p_key and up.effect = 'grant') )
               and not exists (select 1 from public.user_permissions up
                               where up.profile_id = auth.uid() and up.permission_key = p_key and up.effect = 'deny') ) )
$$;

create or replace function public.fn_require_permission(p_key text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_permission(p_key) then
    raise exception 'permission denied: %', p_key using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------ admin safety
create or replace function public.fn_active_admin_count(p_exclude uuid default null) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(distinct p.id)::int from public.profiles p
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where p.is_active and r.is_superuser and r.is_active and (p_exclude is null or p.id <> p_exclude)
$$;

create or replace function public.trg_guard_user_roles() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_super boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception 'user_roles rows cannot be updated' using errcode = 'F0006';
  end if;
  select r.is_superuser into v_super from public.roles r where r.id = old.role_id;
  if v_super then
    if old.profile_id = auth.uid() then
      raise exception 'an admin cannot remove their own administrative role' using errcode = 'F0004';
    end if;
    if public.fn_active_admin_count(old.profile_id) = 0
       and exists (select 1 from public.profiles where id = old.profile_id and is_active) then
      raise exception 'cannot remove the last active admin' using errcode = 'F0004';
    end if;
  end if;
  return old;
end $$;
create trigger guard_user_roles before update or delete on public.user_roles
  for each row execute function public.trg_guard_user_roles();

create or replace function public.trg_guard_profiles() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'profiles cannot be deleted (deactivate instead)' using errcode = 'F0006';
  end if;
  if old.is_active and not new.is_active
     and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.profile_id = old.id and r.is_superuser and r.is_active)
     and public.fn_active_admin_count(old.id) = 0 then
    raise exception 'cannot deactivate the last active admin' using errcode = 'F0004';
  end if;
  return new;
end $$;
create trigger guard_profiles before update or delete on public.profiles
  for each row execute function public.trg_guard_profiles();

create or replace function public.trg_guard_roles() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'system roles cannot be deleted' using errcode = 'F0004'; end if;
    return old;
  end if;
  if old.is_system and (new.is_superuser is distinct from old.is_superuser or new.code is distinct from old.code) then
    raise exception 'system role flags/code cannot be changed' using errcode = 'F0004';
  end if;
  if old.is_superuser and old.is_active and not new.is_active then
    raise exception 'the admin role cannot be deactivated' using errcode = 'F0004';
  end if;
  return new;
end $$;
create trigger guard_roles before update or delete on public.roles
  for each row execute function public.trg_guard_roles();

-- One-time bootstrap of the first admin (service role / SQL editor only; see grants).
create or replace function public.fn_bootstrap_first_admin(p_user uuid, p_username text, p_display text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where r.is_superuser) then
    raise exception 'an admin already exists' using errcode = 'F0004';
  end if;
  insert into public.profiles (id, username, display_name) values (p_user, lower(p_username), coalesce(p_display, p_username));
  insert into public.user_roles (profile_id, role_id) select p_user, id from public.roles where code = 'admin';
  if not found then raise exception 'role admin is missing (run seed migration)' using errcode = 'P0002'; end if;
end $$;

-- audit every identity/permission change
select public.fn_attach_audit('public.employees');
select public.fn_attach_audit('public.employee_pay_terms');
select public.fn_attach_audit('public.profiles');
select public.fn_attach_audit('public.roles');
select public.fn_attach_audit('public.permissions', array['key']);
select public.fn_attach_audit('public.role_permissions', array['role_id','permission_key']);
select public.fn_attach_audit('public.user_roles', array['profile_id','role_id']);
select public.fn_attach_audit('public.user_permissions', array['profile_id','permission_key']);
