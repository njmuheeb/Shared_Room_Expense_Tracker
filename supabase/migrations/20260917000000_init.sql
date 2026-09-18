-- =============================================================================
-- Shared Room Fund Tracker - initial schema
--
-- Model: one shared room fund. Members deposit money into the pot
-- (contributions). Members who buy things out of pocket get paid back by the
-- pot (expenses -> reimbursements). Nobody owes anybody else.
--
-- Core rule: an expense never moves money, it creates a liability. Only a
-- reimbursement with status = 'paid' moves money out of the fund.
--
-- Requires PostgreSQL 15+ (Supabase default) because of security_invoker views.
-- Safe to run once in the Supabase SQL Editor.
-- =============================================================================

-- pgcrypto provides gen_random_bytes(), used to generate join codes from a
-- cryptographically secure source rather than the non-crypto random().
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null check (char_length(name) between 1 and 60),
  join_code                 text not null unique check (join_code ~ '^[A-Z0-9]{6,10}$'),
  currency                  text not null default '$',
  contribution_target_cents integer check (contribution_target_cents is null
                                           or contribution_target_cents > 0),
  is_archived               boolean not null default false,
  created_by                uuid not null references auth.users(id),
  created_at                timestamptz not null default now()
);

create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role         text not null default 'member' check (role in ('admin', 'member')),
  status       text not null default 'active' check (status in ('active', 'removed')),
  joined_at    timestamptz not null default now()
);

create table if not exists public.contributions (
  id                    uuid primary key default gen_random_uuid(),
  room_id               uuid not null references public.rooms(id) on delete cascade,
  member_id             uuid not null references public.members(id),
  amount_cents          integer not null check (amount_cents > 0),
  contributed_on        date not null default current_date,
  method                text,
  note                  text,
  recorded_by_member_id uuid references public.members(id),
  created_by            uuid not null default auth.uid() references auth.users(id),
  created_at            timestamptz not null default now(),
  voided_at             timestamptz,
  void_reason           text
);

create table if not exists public.expenses (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms(id) on delete cascade,
  paid_by_member_id    uuid not null references public.members(id),
  description          text not null check (char_length(description) between 1 and 120),
  amount_cents         integer not null check (amount_cents > 0),
  category             text not null default 'other',
  spent_on             date not null default current_date,
  is_reimbursable      boolean not null default true,
  note                 text,
  created_by_member_id uuid not null references public.members(id),
  created_by           uuid not null default auth.uid() references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  voided_at            timestamptz,
  void_reason          text
);

create table if not exists public.reimbursements (
  id                     uuid primary key default gen_random_uuid(),
  expense_id             uuid not null references public.expenses(id) on delete restrict,
  room_id                uuid not null references public.rooms(id) on delete cascade,
  payee_member_id        uuid not null references public.members(id),
  status                 text not null default 'pending' check (status in ('pending', 'paid')),
  requested_at           timestamptz not null default now(),
  requested_by_member_id uuid references public.members(id),
  paid_at                timestamptz,
  paid_by_member_id      uuid references public.members(id),
  method                 text,
  reference              text,
  created_by             uuid not null default auth.uid() references auth.users(id),
  voided_at              timestamptz,
  void_reason            text,
  constraint reimbursements_paid_fields check (
    (status = 'pending' and paid_at is null and paid_by_member_id is null)
    or
    (status = 'paid' and paid_at is not null and paid_by_member_id is not null)
  )
);

-- ---------------------------------------------------------------------------
-- 2. INDEXES + INTEGRITY
-- ---------------------------------------------------------------------------

-- NULL user_id is allowed more than once (a roommate tracked before they sign in).
create unique index if not exists members_room_user_key
  on public.members (room_id, user_id);

create index if not exists members_room_idx on public.members (room_id);
create index if not exists members_user_idx on public.members (user_id);

-- At most ONE active admin (= treasurer) per room, enforced by the database.
create unique index if not exists one_active_admin_per_room
  on public.members (room_id)
  where role = 'admin' and status = 'active';

create index if not exists contributions_room_date_idx
  on public.contributions (room_id, contributed_on desc);

create index if not exists expenses_room_date_idx
  on public.expenses (room_id, spent_on desc);

create index if not exists reimbursements_room_status_idx
  on public.reimbursements (room_id, status);

-- At most one ACTIVE reimbursement per expense. Voided rows are deliberately
-- excluded so that voiding a payout releases the expense for a corrected
-- re-submission instead of trapping it in a permanently unpaid state.
-- Double payment is still impossible: a second ACTIVE row violates this index.
create unique index if not exists reimbursements_one_active_per_expense
  on public.reimbursements (expense_id)
  where voided_at is null;

-- Retire the original inline UNIQUE (expense_id) constraint if an earlier
-- revision of this file was already applied. That constraint covered voided
-- rows as well, so it would keep the trap alive even though the partial index
-- above now supersedes it. No-op on a fresh database.
alter table public.reimbursements
  drop constraint if exists reimbursements_expense_id_key;

-- ---------------------------------------------------------------------------
-- 3. HELPER FUNCTIONS
--    SECURITY DEFINER is required: a members policy that queried members
--    directly would recurse. search_path = '' forces schema qualification.
-- ---------------------------------------------------------------------------

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.room_id = p_room
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.is_room_admin(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.room_id = p_room
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'admin'
  );
$$;

create or replace function public.current_member_id(p_room uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.room_id = p_room
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_expenses_touch on public.expenses;
create trigger trg_expenses_touch
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- Once an active reimbursement exists, the expense is immutable (except voiding).
-- Otherwise someone could edit the amount after approval and break the ledger.
create or replace function public.lock_reimbursed_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.reimbursements z
    where z.expense_id = old.id
      and z.voided_at is null
  ) then
    if new.room_id is distinct from old.room_id
      or new.paid_by_member_id is distinct from old.paid_by_member_id
      or new.amount_cents is distinct from old.amount_cents
      or new.is_reimbursable is distinct from old.is_reimbursable
      or new.description is distinct from old.description
      or new.spent_on is distinct from old.spent_on
      or new.category is distinct from old.category
      or new.note is distinct from old.note
      or new.voided_at is distinct from old.voided_at
      or new.created_by_member_id is distinct from old.created_by_member_id
    then
      raise exception
        'Expense % has an active reimbursement; void the reimbursement first', old.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expenses_lock on public.expenses;
create trigger trg_expenses_lock
  before update on public.expenses
  for each row execute function public.lock_reimbursed_expense();

-- Members may only change their own display name. Role/status changes go
-- through transfer_admin(), which sets app.skip_member_guard for its transaction.
create or replace function public.guard_member_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Membership is immutable at the row level. A member must never be able to
  -- relocate a row into another room, which would bypass the join code and
  -- grant read access to that room's entire ledger. Joining goes through
  -- join_room(); this check applies even to the RPC paths.
  if new.room_id is distinct from old.room_id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'Members cannot be moved between rooms or re-linked to another user';
  end if;

  if coalesce(current_setting('app.skip_member_guard', true), '') = 'on' then
    return new;
  end if;

  if auth.uid() = old.user_id and not public.is_room_admin(old.room_id) then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
    then
      raise exception 'Members may only change their own display name';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_members_guard on public.members;
create trigger trg_members_guard
  before update on public.members
  for each row execute function public.guard_member_self_update();

-- ---------------------------------------------------------------------------
-- 5. SAFE ACCESS FUNCTIONS (RPCs)
--    These are the only write path for privileged transitions. Because they
--    are SECURITY DEFINER they also need no table grants for the caller.
-- ---------------------------------------------------------------------------

create or replace function public.generate_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code_len  constant int := 10;  -- 32^10 = 2^50 is about 50 bits, the max the rooms check allows
  bytes     bytea;
  code      text;
  i         int;
begin
  loop
    -- gen_random_bytes is a CSPRNG. 256 is an exact multiple of the 32-symbol
    -- alphabet, so the modulo below introduces no bias.
    bytes := extensions.gen_random_bytes(code_len);
    code := '';
    for i in 1..code_len loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i - 1) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.rooms r where r.join_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.create_room(
  p_name         text,
  p_currency     text default '$',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_room uuid;
  v_code text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) < 1 then
    raise exception 'Room name is required';
  end if;

  v_code := public.generate_join_code();

  insert into public.rooms (name, join_code, currency, created_by)
  values (v_name, v_code, coalesce(nullif(trim(p_currency), ''), '$'), v_uid)
  returning id into v_room;

  insert into public.members (room_id, user_id, display_name, role)
  values (v_room, v_uid, coalesce(nullif(trim(p_display_name), ''), 'Member'), 'admin');

  return v_room;
end;
$$;

create or replace function public.join_room(
  p_code         text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_room_id uuid;
  v_member  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select r.id into v_room_id
  from public.rooms r
  where r.join_code = upper(trim(p_code))
    and r.is_archived = false;

  if v_room_id is null then
    raise exception 'Invalid join code';
  end if;

  select m.id into v_member
  from public.members m
  where m.room_id = v_room_id
    and m.user_id = v_uid;

  if v_member is not null then
    -- Reinstating a previously removed membership, or refreshing a display
    -- name, must bypass the self-update guard. Without this the guard sees a
    -- removed self row and raises, which makes this branch dead and prevents
    -- any removed member from ever rejoining.
    perform set_config('app.skip_member_guard', 'on', true);

    update public.members
       set status = 'active',
           display_name = coalesce(nullif(trim(p_display_name), ''), display_name)
     where id = v_member;
    return v_room_id;
  end if;

  insert into public.members (room_id, user_id, display_name, role)
  values (v_room_id, v_uid, coalesce(nullif(trim(p_display_name), ''), 'Member'), 'member');

  return v_room_id;
end;
$$;

create or replace function public.transfer_admin(p_room uuid, p_new_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_room_admin(p_room) then
    raise exception 'Only the current admin can transfer the role';
  end if;

  if not exists (
    select 1
    from public.members
    where id = p_new_member
      and room_id = p_room
      and status = 'active'
  ) then
    raise exception 'Target member not found in this room';
  end if;

  -- Let this transaction past the self-update guard.
  perform set_config('app.skip_member_guard', 'on', true);

  -- Demote first: one_active_admin_per_room can never be violated mid-way.
  update public.members
     set role = 'member'
   where room_id = p_room
     and role = 'admin';

  update public.members
     set role = 'admin'
   where id = p_new_member;
end;
$$;

create or replace function public.request_reimbursement(p_expense uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_exp    public.expenses;
  v_member uuid;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_exp from public.expenses where id = p_expense;
  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;
  if v_exp.voided_at is not null then
    raise exception 'Expense is voided';
  end if;
  if not v_exp.is_reimbursable then
    raise exception 'Expense is not reimbursable';
  end if;
  if not public.is_room_member(v_exp.room_id) then
    raise exception 'Not a member of this room';
  end if;

  v_member := public.current_member_id(v_exp.room_id);
  if v_member is null then
    raise exception 'No active membership in this room';
  end if;

  if v_exp.paid_by_member_id <> v_member and not public.is_room_admin(v_exp.room_id) then
    raise exception 'Only the payer or the admin can request reimbursement';
  end if;

  -- An ACTIVE reimbursement already exists. The partial unique index
  -- reimbursements_one_active_per_expense enforces this structurally; this
  -- guard exists only to return a clear error instead of a raw 23505.
  -- Voided rows are excluded, so a voided payout can be re-requested.
  if exists (
    select 1
    from public.reimbursements z
    where z.expense_id = p_expense
      and z.voided_at is null
  ) then
    raise exception 'This expense already has an active reimbursement';
  end if;

  insert into public.reimbursements
    (expense_id, room_id, payee_member_id, status, requested_by_member_id)
  values
    (p_expense, v_exp.room_id, v_exp.paid_by_member_id, 'pending', v_member)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mark_reimbursement_paid(
  p_reimbursement uuid,
  p_method        text default null,
  p_reference     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_r      public.reimbursements;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_r from public.reimbursements where id = p_reimbursement;
  if v_r.id is null then
    raise exception 'Reimbursement not found';
  end if;
  if v_r.voided_at is not null then
    raise exception 'Reimbursement is voided';
  end if;
  if v_r.status = 'paid' then
    raise exception 'Reimbursement already paid';
  end if;
  if not public.is_room_admin(v_r.room_id) then
    raise exception 'Only the admin can mark reimbursements as paid';
  end if;

  v_member := public.current_member_id(v_r.room_id);

  update public.reimbursements
     set status            = 'paid',
         paid_at           = now(),
         paid_by_member_id = v_member,
         method            = p_method,
         reference         = p_reference
   where id = p_reimbursement
     and status = 'pending';
end;
$$;

create or replace function public.void_expense(p_expense uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp    public.expenses;
  v_member uuid;
begin
  select * into v_exp from public.expenses where id = p_expense;
  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;

  v_member := public.current_member_id(v_exp.room_id);
  if v_member is null then
    raise exception 'No active membership in this room';
  end if;

  if v_exp.created_by_member_id <> v_member and not public.is_room_admin(v_exp.room_id) then
    raise exception 'Only the creator or the admin can void this expense';
  end if;

  if exists (
    select 1
    from public.reimbursements z
    where z.expense_id = p_expense
      and z.voided_at is null
  ) then
    raise exception 'Void the reimbursement first';
  end if;

  update public.expenses
     set voided_at   = now(),
         void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_expense
     and voided_at is null;
end;
$$;

create or replace function public.void_contribution(p_contribution uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.contributions;
begin
  select * into v_c from public.contributions where id = p_contribution;
  if v_c.id is null then
    raise exception 'Contribution not found';
  end if;

  if not public.is_room_admin(v_c.room_id) then
    raise exception 'Only the admin can void contributions';
  end if;

  update public.contributions
     set voided_at   = now(),
         void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_contribution
     and voided_at is null;
end;
$$;

create or replace function public.void_reimbursement(p_reimbursement uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reimbursements;
begin
  select * into v_r from public.reimbursements where id = p_reimbursement;
  if v_r.id is null then
    raise exception 'Reimbursement not found';
  end if;

  if not public.is_room_admin(v_r.room_id) then
    raise exception 'Only the admin can void reimbursements';
  end if;

  update public.reimbursements
     set voided_at   = now(),
         void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_reimbursement
     and voided_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. VIEWS
--    security_invoker is REQUIRED: a default view runs as its owner and would
--    bypass every RLS policy written below.
--
--    fund_cash          = contributions - paid reimbursements
--    pending_liability  = reimbursable expenses with no paid reimbursement
--    available_balance  = fund_cash - pending_liability
-- ---------------------------------------------------------------------------

create or replace view public.room_fund_balance
with (security_invoker = true) as
select
  r.id                                        as room_id,
  coalesce(c.total, 0)                        as total_contributions_cents,
  coalesce(p.total, 0)                        as total_reimbursed_cents,
  coalesce(c.total, 0) - coalesce(p.total, 0) as fund_cash_cents,
  coalesce(l.total, 0)                        as pending_liability_cents,
  coalesce(c.total, 0) - coalesce(p.total, 0) - coalesce(l.total, 0)
                                              as available_balance_cents
from public.rooms r
left join (
  select room_id, sum(amount_cents) as total
  from public.contributions
  where voided_at is null
  group by room_id
) c on c.room_id = r.id
left join (
  select e.room_id, sum(e.amount_cents) as total
  from public.reimbursements z
  join public.expenses e on e.id = z.expense_id
  where z.status = 'paid'
    and z.voided_at is null
    and e.voided_at is null
  group by e.room_id
) p on p.room_id = r.id
left join (
  select e.room_id, sum(e.amount_cents) as total
  from public.expenses e
  where e.voided_at is null
    and e.is_reimbursable
    and not exists (
      select 1
      from public.reimbursements z
      where z.expense_id = e.id
        and z.status = 'paid'
        and z.voided_at is null
    )
  group by e.room_id
) l on l.room_id = r.id;

create or replace view public.member_activity
with (security_invoker = true) as
select
  m.id                                        as member_id,
  m.room_id,
  m.display_name,
  m.role,
  m.status,
  coalesce(c.total, 0)                        as contributed_cents,
  coalesce(z.total, 0)                        as reimbursed_cents,
  coalesce(c.total, 0) - coalesce(z.total, 0) as net_into_fund_cents,
  coalesce(p.total, 0)                        as pending_claim_cents
from public.members m
left join (
  select member_id, sum(amount_cents) as total
  from public.contributions
  where voided_at is null
  group by member_id
) c on c.member_id = m.id
left join (
  select z.payee_member_id as member_id, sum(e.amount_cents) as total
  from public.reimbursements z
  join public.expenses e on e.id = z.expense_id
  where z.status = 'paid'
    and z.voided_at is null
    and e.voided_at is null
  group by z.payee_member_id
) z on z.member_id = m.id
left join (
  select e.paid_by_member_id as member_id, sum(e.amount_cents) as total
  from public.expenses e
  where e.voided_at is null
    and e.is_reimbursable
    and not exists (
      select 1
      from public.reimbursements z
      where z.expense_id = e.id
        and z.status = 'paid'
        and z.voided_at is null
    )
  group by e.paid_by_member_id
) p on p.member_id = m.id;

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.rooms          enable row level security;
alter table public.members        enable row level security;
alter table public.contributions  enable row level security;
alter table public.expenses       enable row level security;
alter table public.reimbursements enable row level security;

-- rooms: members may read; only the admin may update. Creation/joining is via RPC.
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated
  using (public.is_room_member(id));

drop policy if exists rooms_update_admin on public.rooms;
create policy rooms_update_admin on public.rooms
  for update to authenticated
  using (public.is_room_admin(id))
  with check (public.is_room_admin(id));

-- members: read the roster of rooms you belong to.
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (public.is_room_member(room_id));

-- Column-level guard for this policy lives in trg_members_guard.
drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update to authenticated
  using (public.is_room_admin(room_id) or user_id = auth.uid())
  with check (public.is_room_admin(room_id) or user_id = auth.uid());

-- contributions: read all in the room; log your own (admin may log for others).
drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists contributions_insert on public.contributions;
create policy contributions_insert on public.contributions
  for insert to authenticated
  with check (
    public.is_room_member(room_id)
    and (
      member_id = public.current_member_id(room_id)
      or public.is_room_admin(room_id)
    )
    -- created_by has only a column DEFAULT, so it must be pinned here as well,
    -- otherwise any member could attribute a contribution to another user and
    -- defeat the audit trail. Same for recorded_by_member_id.
    and created_by = auth.uid()
    and (
      recorded_by_member_id is null
      or recorded_by_member_id = public.current_member_id(room_id)
      or public.is_room_admin(room_id)
    )
  );

-- expenses: any active member may add one, recording themselves as the payer.
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_room_member(room_id)
    and created_by_member_id = public.current_member_id(room_id)
    and (
      paid_by_member_id = public.current_member_id(room_id)
      or public.is_room_admin(room_id)
    )
    -- Pin the audit column: it is only a DEFAULT, so without this a member
    -- could attribute an expense to another user.
    and created_by = auth.uid()
  );

-- No UPDATE policy on purpose. Expenses are never edited in place: corrections
-- go through void_expense() / void_reimbursement(), which are SECURITY DEFINER
-- and need no table grant. Leaving an update path open allowed moving an
-- expense into another room and clearing voided_at to reverse an admin void.
-- The drop below retires any policy left over from an earlier revision.
drop policy if exists expenses_update on public.expenses;

-- reimbursements: read only. Every write goes through an RPC so that
-- 'paid' can only be set by the admin, with double payment structurally
-- prevented by reimbursements_one_active_per_expense (see section 2).
drop policy if exists reimbursements_select on public.reimbursements;
create policy reimbursements_select on public.reimbursements
  for select to authenticated
  using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- 8. GRANTS (least privilege)
--    The RPCs are SECURITY DEFINER, so the caller needs no table privileges
--    for anything they perform.
-- ---------------------------------------------------------------------------

revoke all on public.rooms,
              public.members,
              public.contributions,
              public.expenses,
              public.reimbursements
  from anon;

revoke all on public.room_fund_balance,
              public.member_activity
  from anon;

grant select, update         on public.rooms          to authenticated;
grant select, update         on public.members        to authenticated;
grant select, insert         on public.contributions  to authenticated;
grant select, insert         on public.expenses       to authenticated;
grant select                 on public.reimbursements  to authenticated;
grant select                 on public.room_fund_balance to authenticated;
grant select                 on public.member_activity  to authenticated;

-- Internal helper: never callable from a client.
revoke execute on function public.generate_join_code() from public, anon, authenticated;

-- Write RPCs: authenticated only (no anon, no bare public).
revoke execute on function public.create_room(text, text, text)              from public, anon;
revoke execute on function public.join_room(text, text)                      from public, anon;
revoke execute on function public.transfer_admin(uuid, uuid)                 from public, anon;
revoke execute on function public.request_reimbursement(uuid)                from public, anon;
revoke execute on function public.mark_reimbursement_paid(uuid, text, text)  from public, anon;
revoke execute on function public.void_expense(uuid, text)                   from public, anon;
revoke execute on function public.void_contribution(uuid, text)              from public, anon;
revoke execute on function public.void_reimbursement(uuid, text)             from public, anon;

grant execute on function public.create_room(text, text, text)             to authenticated;
grant execute on function public.join_room(text, text)                     to authenticated;
grant execute on function public.transfer_admin(uuid, uuid)                to authenticated;
grant execute on function public.request_reimbursement(uuid)               to authenticated;
grant execute on function public.mark_reimbursement_paid(uuid, text, text) to authenticated;
grant execute on function public.void_expense(uuid, text)                  to authenticated;
grant execute on function public.void_contribution(uuid, text)             to authenticated;
grant execute on function public.void_reimbursement(uuid, text)            to authenticated;

-- ---------------------------------------------------------------------------
-- 9. REALTIME
-- ---------------------------------------------------------------------------

alter table public.expenses       replica identity full;
alter table public.reimbursements replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['expenses', 'contributions', 'reimbursements'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then
        null; -- already published
    end;
  end loop;
end;
$$;
