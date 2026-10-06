-- =============================================================================
-- Shared Room Fund Tracker
-- Step 2: financial correctness, accounting periods, corrections and audit
--
-- Depends on 20260917000000_init.sql
--           20260930000000_expense_payment_source.sql
--
-- Fixes the three accounting defects in the original views:
--   1. Common-fund expenses (payment_source = 'common') were never subtracted,
--      so "fund cash" overstated the money actually in the pot.
--   2. Available balance subtracted pending reimbursement liabilities, so money
--      the room still owed was reported as money the room could not spend.
--   3. Pending personal expenses were computed from the legacy is_reimbursable
--      flag instead of the authoritative payment_source column.
--
-- Adds:
--   * accounting_periods  - arbitrary date ranges; one open period per room,
--                           non-overlapping, closed periods are immutable.
--   * financial_audit_log - append-only trail for every correction/void.
--   * reimbursements.paid_on - user-supplied payment date.
--   * correct_expense / create_accounting_period / close_accounting_period /
--     room_export RPCs.
--
-- All money stays integer minor units. No floats.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. ACCOUNTING PERIODS
-- ---------------------------------------------------------------------------

create table if not exists public.accounting_periods (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.rooms(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 60),
  starts_on           date not null,
  ends_on             date not null,
  status              text not null default 'open'
                        check (status in ('open', 'closed')),
  closed_at           timestamptz,
  closed_by_member_id uuid references public.members(id),
  created_by          uuid not null default auth.uid() references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint accounting_periods_range check (ends_on >= starts_on),
  -- A closed period must record who closed it and when. An open one must not.
  constraint accounting_periods_close_fields check (
    (status = 'open'   and closed_at is null     and closed_by_member_id is null)
    or
    (status = 'closed' and closed_at is not null and closed_by_member_id is not null)
  )
);

create index if not exists accounting_periods_room_idx
  on public.accounting_periods (room_id, starts_on);

-- At most ONE open period per room. Two concurrent open periods would let the
-- UI offer an ambiguous "current period" and break period-scoped exports.
create unique index if not exists one_open_period_per_room
  on public.accounting_periods (room_id)
  where status = 'open';


-- ---------------------------------------------------------------------------
-- 2. AUDIT LOG
-- ---------------------------------------------------------------------------

create table if not exists public.financial_audit_log (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms(id) on delete cascade,
  actor_member_id  uuid references public.members(id) on delete set null,
  action           text not null check (char_length(action) between 1 and 60),
  entity_type      text not null check (char_length(entity_type) between 1 and 40),
  entity_id        uuid,
  reason           text,
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists financial_audit_log_room_idx
  on public.financial_audit_log (room_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 3. REIMBURSEMENT PAYMENT DATE
--
-- paid_at is the server clock; paid_on is the date the money actually changed
-- hands, which is what period close and CSV export are reported against.
-- ---------------------------------------------------------------------------

alter table public.reimbursements
  add column if not exists paid_on date;

-- Backfill before the constraint swap, otherwise existing paid rows violate it.
update public.reimbursements
   set paid_on = paid_at::date
 where status = 'paid'
   and paid_on is null
   and paid_at is not null;

alter table public.reimbursements
  drop constraint if exists reimbursements_paid_fields;

alter table public.reimbursements
  add constraint reimbursements_paid_fields check (
    (status = 'pending' and paid_at is null and paid_by_member_id is null and paid_on is null)
    or
    (status = 'paid'    and paid_at is not null and paid_by_member_id is not null and paid_on is not null)
  );


-- ---------------------------------------------------------------------------
-- 4. DERIVED HELPERS
-- ---------------------------------------------------------------------------

-- Cash physically in the pot:
--   contributions - common-fund expenses - reimbursements already paid out.
--
-- This is the single definition of "what is actually there". The balance view,
-- the payment guard and the export all read it so they can never disagree.
create or replace function public.room_available_cents(p_room uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(c.amount_cents)
                from public.contributions c
               where c.room_id = p_room
                 and c.voided_at is null), 0)
  - coalesce((select sum(e.amount_cents)
                from public.expenses e
               where e.room_id = p_room
                 and e.voided_at is null
                 and e.payment_source = 'common'), 0)
  - coalesce((select sum(e.amount_cents)
                from public.reimbursements z
                join public.expenses e on e.id = z.expense_id
               where z.room_id = p_room
                 and z.status = 'paid'
                 and z.voided_at is null
                 and e.voided_at is null), 0);
$$;

-- A personal expense creates a liability only while nothing has been paid for
-- it. payment_source is authoritative; is_reimbursable is the legacy mirror.
create or replace function public.room_pending_liability_cents(p_room uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sum(e.amount_cents)
      from public.expenses e
     where e.room_id = p_room
       and e.voided_at is null
       and e.payment_source = 'personal'
       and e.is_reimbursable
       and not exists (
         select 1
           from public.reimbursements z
          where z.expense_id = e.id
            and z.status = 'paid'
            and z.voided_at is null
       )
  ), 0);
$$;


-- ---------------------------------------------------------------------------
-- 5. CLOSED-PERIOD GUARD
-- ---------------------------------------------------------------------------

-- Raises when a dated financial record falls inside a closed period of the room.
-- Rooms with no periods at all are unaffected: every date stays editable, which
-- keeps this migration safe to apply to a database that is already in use.
create or replace function public.assert_period_open(
  p_room uuid,
  p_on   date,
  p_kind text default 'record'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.accounting_periods;
begin
  if p_on is null then
    return;
  end if;

  select * into v_period
    from public.accounting_periods ap
   where ap.room_id = p_room
     and ap.status = 'closed'
     and p_on >= ap.starts_on
     and p_on <= ap.ends_on
   order by ap.starts_on desc
   limit 1;

  if v_period.id is not null then
    raise exception
      'This % is dated % which falls inside the closed accounting period "%" (%). Closed periods are kept as history and can no longer be changed.',
      p_kind,
      p_on,
      v_period.name,
      v_period.starts_on || ' to ' || v_period.ends_on;
  end if;
end;
$$;

-- Expenses: single source of truth for payment_source, plus the period guard.
create or replace function public.guard_expense_financials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A common-fund expense can never be reimbursed. Enforcing it here means no
  -- code path can produce a row that would be counted as BOTH a fund outflow
  -- and a pending liability, which was the double-counting defect.
  if new.payment_source = 'common' then
    new.is_reimbursable := false;
  end if;

  perform public.assert_period_open(new.room_id, new.spent_on, 'expense');
  return new;
end;
$$;

drop trigger if exists trg_expenses_financials on public.expenses;
create trigger trg_expenses_financials
  before insert or update on public.expenses
  for each row execute function public.guard_expense_financials();

create or replace function public.guard_contribution_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_period_open(new.room_id, new.contributed_on, 'contribution');
  return new;
end;
$$;

drop trigger if exists trg_contributions_period on public.contributions;
create trigger trg_contributions_period
  before insert or update on public.contributions
  for each row execute function public.guard_contribution_period();

-- A reimbursement is settled or voided as part of its expense's period, so the
-- guard keys off the parent expense date rather than its own creation date.
create or replace function public.guard_reimbursement_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spent_on date;
begin
  select e.spent_on into v_spent_on
    from public.expenses e
   where e.id = new.expense_id;

  perform public.assert_period_open(new.room_id, v_spent_on, 'reimbursement');
  return new;
end;
$$;

drop trigger if exists trg_reimbursements_period on public.reimbursements;
create trigger trg_reimbursements_period
  before insert or update on public.reimbursements
  for each row execute function public.guard_reimbursement_period();

-- payment_source is ledger-critical: once a reimbursement exists, flipping the
-- source would move the amount between the liability and the cash columns.
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
      or new.payment_source is distinct from old.payment_source
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


-- ---------------------------------------------------------------------------
-- 6. AUDIT HELPER
-- ---------------------------------------------------------------------------

create or replace function public.write_audit(
  p_room        uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_reason      text,
  p_details     jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.financial_audit_log
    (room_id, actor_member_id, action, entity_type, entity_id, reason, details)
  values
    (
      p_room,
      public.current_member_id(p_room),
      p_action,
      p_entity_type,
      p_entity_id,
      nullif(trim(coalesce(p_reason, '')), ''),
      coalesce(p_details, '{}'::jsonb)
    );
$$;


-- ---------------------------------------------------------------------------
-- 7. PERIOD RPCs (admin only)
-- ---------------------------------------------------------------------------

create or replace function public.create_accounting_period(
  p_room      uuid,
  p_name      text,
  p_starts_on date,
  p_ends_on   date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_name    text;
  v_clash   public.accounting_periods;
begin
  if not public.is_room_admin(p_room) then
    raise exception 'Only the admin can manage accounting periods';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) < 1 then
    raise exception 'Period name is required';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Period name must be 60 characters or fewer';
  end if;

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Period end date must not be before its start date';
  end if;

  -- Serialize concurrent period creation for this room so the open-period and
  -- overlap checks below cannot both pass under a race.
  perform pg_advisory_xact_lock(hashtext('period:' || p_room::text));

  if exists (
    select 1 from public.accounting_periods
     where room_id = p_room and status = 'open'
  ) then
    raise exception
      'This room already has an open period. Close it before opening a new one.';
  end if;

  select * into v_clash
    from public.accounting_periods
   where room_id = p_room
     and p_starts_on <= ends_on
     and p_ends_on   >= starts_on
   order by starts_on
   limit 1;

  if v_clash.id is not null then
    raise exception
      'That range overlaps the existing period "%" (% to %)',
      v_clash.name, v_clash.starts_on, v_clash.ends_on;
  end if;

  insert into public.accounting_periods (room_id, name, starts_on, ends_on)
  values (p_room, v_name, p_starts_on, p_ends_on)
  returning id into v_id;

  perform public.write_audit(
    p_room, 'create_period', 'period', v_id,
    v_name,
    jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on)
  );

  return v_id;
end;
$$;

create or replace function public.close_accounting_period(p_period uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.accounting_periods;
  v_member   uuid;
  v_pending  integer;
  v_net      integer;
begin
  select * into v_p from public.accounting_periods where id = p_period;
  if v_p.id is null then
    raise exception 'Accounting period not found';
  end if;

  if not public.is_room_admin(v_p.room_id) then
    raise exception 'Only the admin can close accounting periods';
  end if;

  if v_p.status = 'closed' then
    raise exception 'This period is already closed';
  end if;

  v_member := public.current_member_id(v_p.room_id);

  -- Refuse to close a period that still holds unsettled claims: settling them
  -- afterwards would be rejected by the period guard and freeze the liability.
  select count(*)::integer into v_pending
    from public.reimbursements z
    join public.expenses e on e.id = z.expense_id
   where z.room_id = v_p.room_id
     and z.status = 'pending'
     and z.voided_at is null
     and e.voided_at is null
     and e.spent_on >= v_p.starts_on
     and e.spent_on <= v_p.ends_on;

  if v_pending > 0 then
    raise exception
      'This period still has % unsettled reimbursement(s). Settle or void them before closing.',
      v_pending;
  end if;

  -- Refuse to close a period where the fund ran overdrawn: the shortfall has to
  -- be explained by a contribution in a later period, which needs this one open.
  select
      coalesce((select sum(c.amount_cents)
                  from public.contributions c
                 where c.room_id = v_p.room_id
                   and c.voided_at is null
                   and c.contributed_on >= v_p.starts_on
                   and c.contributed_on <= v_p.ends_on), 0)
    - coalesce((select sum(e.amount_cents)
                  from public.expenses e
                 where e.room_id = v_p.room_id
                   and e.voided_at is null
                   and e.payment_source = 'common'
                   and e.spent_on >= v_p.starts_on
                   and e.spent_on <= v_p.ends_on), 0)
    - coalesce((select sum(e.amount_cents)
                  from public.reimbursements z
                  join public.expenses e on e.id = z.expense_id
                 where z.room_id = v_p.room_id
                   and z.status = 'paid'
                   and z.voided_at is null
                   and e.voided_at is null
                   and e.spent_on >= v_p.starts_on
                   and e.spent_on <= v_p.ends_on), 0)
  into v_net;

  if v_net < 0 then
    raise exception
      'This period is overdrawn by %. Closing it would lock in a shortfall; add the missing contribution first.',
      (v_net / 100.0);
  end if;

  update public.accounting_periods
     set status              = 'closed',
         closed_at           = now(),
         closed_by_member_id = v_member
   where id = p_period
     and status = 'open';

  -- A concurrent close can win the race; then this transaction changed nothing
  -- and must not claim in the audit log that it closed the period.
  if not found then
    raise exception 'This period was closed by someone else';
  end if;

  perform public.write_audit(
    v_p.room_id, 'close_period', 'period', p_period,
    v_p.name,
    jsonb_build_object('starts_on', v_p.starts_on, 'ends_on', v_p.ends_on, 'net_cents', v_net)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. ADMIN CORRECTIONS
--
-- Expenses are never edited in place from the client (there is no UPDATE
-- policy). This is the one audited path an admin has to fix a mistake.
-- ---------------------------------------------------------------------------

create or replace function public.correct_expense(
  p_expense       uuid,
  p_description   text default null,
  p_amount_cents  integer default null,
  p_category      text default null,
  p_spent_on      date default null,
  p_payment_source text default null,
  p_note          text default null,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''-- =============================================================================
-- Shared Room Fund Tracker
-- Step 2: financial correctness, accounting periods, corrections and audit
--
-- Depends on 20260917000000_init.sql
--           20260930000000_expense_payment_source.sql
--
-- Fixes the three accounting defects in the original views:
--   1. Common-fund expenses (payment_source = 'common') were never subtracted,
--      so "fund cash" overstated the money actually in the pot.
--   2. Available balance subtracted pending reimbursement liabilities, so money
--      the room still owed was reported as money the room could not spend.
--   3. Pending personal expenses were computed from the legacy is_reimbursable
--      flag instead of the authoritative payment_source column.
--
-- Adds:
--   * accounting_periods  - arbitrary date ranges; one open period per room,
--                           non-overlapping, closed periods are immutable.
--   * financial_audit_log - append-only trail for every correction/void.
--   * reimbursements.paid_on - user-supplied payment date.
--   * correct_expense / create_accounting_period / close_accounting_period /
--     room_export RPCs.
--
-- All money stays integer minor units. No floats.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. ACCOUNTING PERIODS
-- ---------------------------------------------------------------------------

create table if not exists public.accounting_periods (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.rooms(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 60),
  starts_on           date not null,
  ends_on             date not null,
  status              text not null default 'open'
                        check (status in ('open', 'closed')),
  closed_at           timestamptz,
  closed_by_member_id uuid references public.members(id),
  created_by          uuid not null default auth.uid() references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint accounting_periods_range check (ends_on >= starts_on),
  -- A closed period must record who closed it and when. An open one must not.
  constraint accounting_periods_close_fields check (
    (status = 'open'   and closed_at is null     and closed_by_member_id is null)
    or
    (status = 'closed' and closed_at is not null and closed_by_member_id is not null)
  )
);

create index if not exists accounting_periods_room_idx
  on public.accounting_periods (room_id, starts_on);

-- At most ONE open period per room. Two concurrent open periods would let the
-- UI offer an ambiguous "current period" and break period-scoped exports.
create unique index if not exists one_open_period_per_room
  on public.accounting_periods (room_id)
  where status = 'open';


-- ---------------------------------------------------------------------------
-- 2. AUDIT LOG
-- ---------------------------------------------------------------------------

create table if not exists public.financial_audit_log (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms(id) on delete cascade,
  actor_member_id  uuid references public.members(id) on delete set null,
  action           text not null check (char_length(action) between 1 and 60),
  entity_type      text not null check (char_length(entity_type) between 1 and 40),
  entity_id        uuid,
  reason           text,
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists financial_audit_log_room_idx
  on public.financial_audit_log (room_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 3. REIMBURSEMENT PAYMENT DATE
--
-- paid_at is the server clock; paid_on is the date the money actually changed
-- hands, which is what period close and CSV export are reported against.
-- ---------------------------------------------------------------------------

alter table public.reimbursements
  add column if not exists paid_on date;

-- Backfill before the constraint swap, otherwise existing paid rows violate it.
update public.reimbursements
   set paid_on = paid_at::date
 where status = 'paid'
   and paid_on is null
   and paid_at is not null;

alter table public.reimbursements
  drop constraint if exists reimbursements_paid_fields;

alter table public.reimbursements
  add constraint reimbursements_paid_fields check (
    (status = 'pending' and paid_at is null and paid_by_member_id is null and paid_on is null)
    or
    (status = 'paid'    and paid_at is not null and paid_by_member_id is not null and paid_on is not null)
  );


-- ---------------------------------------------------------------------------
-- 4. DERIVED HELPERS
-- ---------------------------------------------------------------------------

-- Cash physically in the pot:
--   contributions - common-fund expenses - reimbursements already paid out.
--
-- This is the single definition of "what is actually there". The balance view,
-- the payment guard and the export all read it so they can never disagree.
create or replace function public.room_available_cents(p_room uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(c.amount_cents)
                from public.contributions c
               where c.room_id = p_room
                 and c.voided_at is null), 0)
  - coalesce((select sum(e.amount_cents)
                from public.expenses e
               where e.room_id = p_room
                 and e.voided_at is null
                 and e.payment_source = 'common'), 0)
  - coalesce((select sum(e.amount_cents)
                from public.reimbursements z
                join public.expenses e on e.id = z.expense_id
               where z.room_id = p_room
                 and z.status = 'paid'
                 and z.voided_at is null
                 and e.voided_at is null), 0);
$$;

-- A personal expense creates a liability only while nothing has been paid for
-- it. payment_source is authoritative; is_reimbursable is the legacy mirror.
create or replace function public.room_pending_liability_cents(p_room uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sum(e.amount_cents)
      from public.expenses e
     where e.room_id = p_room
       and e.voided_at is null
       and e.payment_source = 'personal'
       and e.is_reimbursable
       and not exists (
         select 1
           from public.reimbursements z
          where z.expense_id = e.id
            and z.status = 'paid'
            and z.voided_at is null
       )
  ), 0);
$$;


-- ---------------------------------------------------------------------------
-- 5. CLOSED-PERIOD GUARD
-- ---------------------------------------------------------------------------

-- Raises when a dated financial record falls inside a closed period of the room.
-- Rooms with no periods at all are unaffected: every date stays editable, which
-- keeps this migration safe to apply to a database that is already in use.
create or replace function public.assert_period_open(
  p_room uuid,
  p_on   date,
  p_kind text default 'record'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.accounting_periods;
begin
  if p_on is null then
    return;
  end if;

  select * into v_period
    from public.accounting_periods ap
   where ap.room_id = p_room
     and ap.status = 'closed'
     and p_on >= ap.starts_on
     and p_on <= ap.ends_on
   order by ap.starts_on desc
   limit 1;

  if v_period.id is not null then
    raise exception
      'This % is dated % which falls inside the closed accounting period "%" (%). Closed periods are kept as history and can no longer be changed.',
      p_kind,
      p_on,
      v_period.name,
      v_period.starts_on || ' to ' || v_period.ends_on;
  end if;
end;
$$;

-- Expenses: single source of truth for payment_source, plus the period guard.
create or replace function public.guard_expense_financials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A common-fund expense can never be reimbursed. Enforcing it here means no
  -- code path can produce a row that would be counted as BOTH a fund outflow
  -- and a pending liability, which was the double-counting defect.
  if new.payment_source = 'common' then
    new.is_reimbursable := false;
  end if;

  perform public.assert_period_open(new.room_id, new.spent_on, 'expense');
  return new;
end;
$$;

drop trigger if exists trg_expenses_financials on public.expenses;
create trigger trg_expenses_financials
  before insert or update on public.expenses
  for each row execute function public.guard_expense_financials();

create or replace function public.guard_contribution_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_period_open(new.room_id, new.contributed_on, 'contribution');
  return new;
end;
$$;

drop trigger if exists trg_contributions_period on public.contributions;
create trigger trg_contributions_period
  before insert or update on public.contributions
  for each row execute function public.guard_contribution_period();

-- A reimbursement is settled or voided as part of its expense's period, so the
-- guard keys off the parent expense date rather than its own creation date.
create or replace function public.guard_reimbursement_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spent_on date;
begin
  select e.spent_on into v_spent_on
    from public.expenses e
   where e.id = new.expense_id;

  perform public.assert_period_open(new.room_id, v_spent_on, 'reimbursement');
  return new;
end;
$$;

drop trigger if exists trg_reimbursements_period on public.reimbursements;
create trigger trg_reimbursements_period
  before insert or update on public.reimbursements
  for each row execute function public.guard_reimbursement_period();

-- payment_source is ledger-critical: once a reimbursement exists, flipping the
-- source would move the amount between the liability and the cash columns.
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
      or new.payment_source is distinct from old.payment_source
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


-- ---------------------------------------------------------------------------
-- 6. AUDIT HELPER
-- ---------------------------------------------------------------------------

create or replace function public.write_audit(
  p_room        uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_reason      text,
  p_details     jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.financial_audit_log
    (room_id, actor_member_id, action, entity_type, entity_id, reason, details)
  values
    (
      p_room,
      public.current_member_id(p_room),
      p_action,
      p_entity_type,
      p_entity_id,
      nullif(trim(coalesce(p_reason, '')), ''),
      coalesce(p_details, '{}'::jsonb)
    );
$$;


-- ---------------------------------------------------------------------------
-- 7. PERIOD RPCs (admin only)
-- ---------------------------------------------------------------------------

create or replace function public.create_accounting_period(
  p_room      uuid,
  p_name      text,
  p_starts_on date,
  p_ends_on   date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_name    text;
  v_clash   public.accounting_periods;
begin
  if not public.is_room_admin(p_room) then
    raise exception 'Only the admin can manage accounting periods';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) < 1 then
    raise exception 'Period name is required';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Period name must be 60 characters or fewer';
  end if;

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Period end date must not be before its start date';
  end if;

  -- Serialize concurrent period creation for this room so the open-period and
  -- overlap checks below cannot both pass under a race.
  perform pg_advisory_xact_lock(hashtext('period:' || p_room::text));

  if exists (
    select 1 from public.accounting_periods
     where room_id = p_room and status = 'open'
  ) then
    raise exception
      'This room already has an open period. Close it before opening a new one.';
  end if;

  select * into v_clash
    from public.accounting_periods
   where room_id = p_room
     and p_starts_on <= ends_on
     and p_ends_on   >= starts_on
   order by starts_on
   limit 1;

  if v_clash.id is not null then
    raise exception
      'That range overlaps the existing period "%" (% to %)',
      v_clash.name, v_clash.starts_on, v_clash.ends_on;
  end if;

  insert into public.accounting_periods (room_id, name, starts_on, ends_on)
  values (p_room, v_name, p_starts_on, p_ends_on)
  returning id into v_id;

  perform public.write_audit(
    p_room, 'create_period', 'period', v_id,
    v_name,
    jsonb_build_object('starts_on', p_starts_on, 'ends_on', p_ends_on)
  );

  return v_id;
end;
$$;

create or replace function public.close_accounting_period(p_period uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.accounting_periods;
  v_member   uuid;
  v_pending  integer;
  v_net      integer;
begin
  select * into v_p from public.accounting_periods where id = p_period;
  if v_p.id is null then
    raise exception 'Accounting period not found';
  end if;

  if not public.is_room_admin(v_p.room_id) then
    raise exception 'Only the admin can close accounting periods';
  end if;

  if v_p.status = 'closed' then
    raise exception 'This period is already closed';
  end if;

  v_member := public.current_member_id(v_p.room_id);

  -- Refuse to close a period that still holds unsettled claims: settling them
  -- afterwards would be rejected by the period guard and freeze the liability.
  select count(*)::integer into v_pending
    from public.reimbursements z
    join public.expenses e on e.id = z.expense_id
   where z.room_id = v_p.room_id
     and z.status = 'pending'
     and z.voided_at is null
     and e.voided_at is null
     and e.spent_on >= v_p.starts_on
     and e.spent_on <= v_p.ends_on;

  if v_pending > 0 then
    raise exception
      'This period still has % unsettled reimbursement(s). Settle or void them before closing.',
      v_pending;
  end if;

  -- Refuse to close a period where the fund ran overdrawn: the shortfall has to
  -- be explained by a contribution in a later period, which needs this one open.
  select
      coalesce((select sum(c.amount_cents)
                  from public.contributions c
                 where c.room_id = v_p.room_id
                   and c.voided_at is null
                   and c.contributed_on >= v_p.starts_on
                   and c.contributed_on <= v_p.ends_on), 0)
    - coalesce((select sum(e.amount_cents)
                  from public.expenses e
                 where e.room_id = v_p.room_id
                   and e.voided_at is null
                   and e.payment_source = 'common'
                   and e.spent_on >= v_p.starts_on
                   and e.spent_on <= v_p.ends_on), 0)
    - coalesce((select sum(e.amount_cents)
                  from public.reimbursements z
                  join public.expenses e on e.id = z.expense_id
                 where z.room_id = v_p.room_id
                   and z.status = 'paid'
                   and z.voided_at is null
                   and e.voided_at is null
                   and e.spent_on >= v_p.starts_on
                   and e.spent_on <= v_p.ends_on), 0)
  into v_net;

  if v_net < 0 then
    raise exception
      'This period is overdrawn by %. Closing it would lock in a shortfall; add the missing contribution first.',
      (v_net / 100.0);
  end if;

  update public.accounting_periods
     set status              = 'closed',
         closed_at           = now(),
         closed_by_member_id = v_member
   where id = p_period
     and status = 'open';

  -- A concurrent close can win the race; then this transaction changed nothing
  -- and must not claim in the audit log that it closed the period.
  if not found then
    raise exception 'This period was closed by someone else';
  end if;

  perform public.write_audit(
    v_p.room_id, 'close_period', 'period', p_period,
    v_p.name,
    jsonb_build_object('starts_on', v_p.starts_on, 'ends_on', v_p.ends_on, 'net_cents', v_net)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. ADMIN CORRECTIONS
--
-- Expenses are never edited in place from the client (there is no UPDATE
-- policy). This is the one audited path an admin has to fix a mistake.
-- ---------------------------------------------------------------------------

create or replace function public.correct_expense(
  p_expense       uuid,
  p_description   text default null,
  p_amount_cents  integer default null,
  p_category      text default null,
  p_spent_on      date default null,
  p_payment_source text default null,
  p_note          text default null,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp    public.expenses;
  v_after  public.expenses;
  v_member uuid;
  v_reason text;
begin
  select * into v_exp from public.expenses where id = p_expense;
  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;

  if not public.is_room_admin(v_exp.room_id) then
    raise exception 'Only the admin can correct an expense';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 then
    raise exception 'A correction needs a reason of at least 3 characters';
  end if;

  if p_amount_cents is not null and p_amount_cents <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  if p_payment_source is not null and p_payment_source not in ('common', 'personal') then
    raise exception 'Payment source must be common or personal';
  end if;

  if p_description is not null
     and char_length(trim(p_description)) not between 1 and 120 then
    raise exception 'Description must be 1 to 120 characters';
  end if;

  if p_category is not null
     and char_length(trim(p_category)) not between 1 and 40 then
    raise exception 'Category must be 1 to 40 characters';
  end if;

  -- A voided row is history. Editing it would leave an audit trail whose
  -- "after" state is a record nobody can see in the ledger, so require the
  -- expense to be live.
  if v_exp.voided_at is not null then
    raise exception 'This expense is voided; voided records cannot be corrected';
  end if;

  -- Every argument is nullable and means "leave this field alone", so an
  -- omitted argument can never silently erase data.
  if p_description   is null and p_amount_cents is null
     and p_category   is null and p_spent_on   is null
     and p_payment_source is null and p_note    is null then
    raise exception 'A correction must change at least one field';
  end if;

  -- The period guard and the active-reimbursement lock both fire on this UPDATE
  -- from their own triggers, so a correction can never rewrite closed history
  -- or alter an already-settled amount.
  update public.expenses
     set description    = coalesce(nullif(trim(p_description), ''), description),
         amount_cents   = coalesce(p_amount_cents, amount_cents),
         category       = coalesce(nullif(trim(p_category), ''), category),
         spent_on       = coalesce(p_spent_on, spent_on),
         payment_source = coalesce(p_payment_source, payment_source),
         note           = coalesce(p_note, note)
   where id = p_expense;

  select * into v_after from public.expenses where id = p_expense;

  v_member := public.current_member_id(v_exp.room_id);

  perform public.write_audit(
    v_exp.room_id, 'correct_expense', 'expense', p_expense,
    v_reason,
    jsonb_build_object(
      'before', to_jsonb(v_exp),
      'after',  to_jsonb(v_after)
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. REIMBURSEMENT SETTLEMENT
--
-- The old 3-argument overload is dropped, not superseded: leaving it callable
-- would be a back door that skips both the payment date and the funds check.
-- ---------------------------------------------------------------------------

revoke execute on function public.mark_reimbursement_paid(uuid, text, text)
  from public, anon, authenticated;
drop function if exists public.mark_reimbursement_paid(uuid, text, text);

create or replace function public.mark_reimbursement_paid(
  p_reimbursement uuid,
  p_method        text default null,
  p_reference     text default null,
  p_paid_on       date   default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r          public.reimbursements;
  v_exp        public.expenses;
  v_member     uuid;
  v_available  integer;
  v_paid_on    date;
begin
  if auth.uid() is null then
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

  v_paid_on := coalesce(p_paid_on, current_date);
  if v_paid_on > current_date then
    raise exception 'The payment date cannot be in the future';
  end if;

  select * into v_exp from public.expenses where id = v_r.expense_id;
  if v_exp.voided_at is not null then
    raise exception 'The expense behind this reimbursement is voided';
  end if;

  -- Settling a claim moves money out of the pot. Refuse when that would leave
  -- the fund negative: an overdrawn fund is a bookkeeping problem, not a
  -- payment the treasurer should be allowed to silently create.
  --
  -- The lock is taken before the balance is read: two treasurers settling two
  -- claims at the same time could otherwise both read the pre-payment balance,
  -- both pass the check, and overdraw the fund.
  perform pg_advisory_xact_lock(hashtext('settle:' || v_r.room_id::text));

  v_available := public.room_available_cents(v_r.room_id);

  if v_available < v_exp.amount_cents then
    raise exception
      'Not enough in the common fund: %. available, %. owed. Add a contribution before paying this.',
      (v_available / 100.0),
      (v_exp.amount_cents / 100.0);
  end if;

  v_member := public.current_member_id(v_r.room_id);

  update public.reimbursements
     set status            = 'paid',
         paid_at           = now(),
         paid_on           = v_paid_on,
         paid_by_member_id = v_member,
         method            = p_method,
         reference         = p_reference
   where id = p_reimbursement
     and status = 'pending';

  -- The advisory lock above serialises settlements per room, so losing this
  -- race is not expected; check anyway rather than audit-logging a payment
  -- that was never written.
  if not found then
    raise exception 'This reimbursement was paid by someone else';
  end if;

  perform public.write_audit(
    v_r.room_id, 'mark_reimbursement_paid', 'reimbursement', p_reimbursement,
    null,
    jsonb_build_object(
      'expense_id', v_exp.id,
      'amount_cents', v_exp.amount_cents,
      'paid_on', v_paid_on,
      'method', p_method,
      'reference', p_reference
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 10. VOIDS (now audited; period protection comes from the triggers above)
-- ---------------------------------------------------------------------------

create or replace function public.void_expense(p_expense uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp    public.expenses;
  v_member uuid;
  v_reason text;
begin
  select * into v_exp from public.expenses where id = p_expense;
  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;
  if v_exp.voided_at is not null then
    raise exception 'Expense is already voided';
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

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  update public.expenses
     set voided_at   = now(),
         void_reason = v_reason
   where id = p_expense
     and voided_at is null;

  perform public.write_audit(
    v_exp.room_id, 'void_expense', 'expense', p_expense,
    v_reason,
    jsonb_build_object('amount_cents', v_exp.amount_cents, 'spent_on', v_exp.spent_on)
  );
end;
$$;

create or replace function public.void_contribution(p_contribution uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      public.contributions;
  v_reason text;
begin
  select * into v_c from public.contributions where id = p_contribution;
  if v_c.id is null then
    raise exception 'Contribution not found';
  end if;
  if v_c.voided_at is not null then
    raise exception 'Contribution is already voided';
  end if;

  if not public.is_room_admin(v_c.room_id) then
    raise exception 'Only the admin can void contributions';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  update public.contributions
     set voided_at   = now(),
         void_reason = v_reason
   where id = p_contribution
     and voided_at is null;

  perform public.write_audit(
    v_c.room_id, 'void_contribution', 'contribution', p_contribution,
    v_reason,
    jsonb_build_object('amount_cents', v_c.amount_cents, 'contributed_on', v_c.contributed_on)
  );
end;
$$;

create or replace function public.void_reimbursement(p_reimbursement uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reimbursements;
  v_reason text;
  v_amount integer;
begin
  select * into v_r from public.reimbursements where id = p_reimbursement;
  if v_r.id is null then
    raise exception 'Reimbursement not found';
  end if;
  if v_r.voided_at is not null then
    raise exception 'Reimbursement is already voided';
  end if;

  if not public.is_room_admin(v_r.room_id) then
    raise exception 'Only the admin can void reimbursements';
  end if;

  select e.amount_cents into v_amount
    from public.expenses e where e.id = v_r.expense_id;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  update public.reimbursements
     set voided_at   = now(),
         void_reason = v_reason
   where id = p_reimbursement
     and voided_at is null;

  perform public.write_audit(
    v_r.room_id, 'void_reimbursement', 'reimbursement', p_reimbursement,
    v_reason,
    jsonb_build_object(
      'expense_id', v_r.expense_id,
      'amount_cents', v_amount,
      'was_paid', v_r.status = 'paid'
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 11. CORRECTED VIEWS
--
-- create or replace cannot add columns to an existing view, so these are
-- dropped and recreated. Nothing depends on them.
-- ---------------------------------------------------------------------------

drop view if exists public.room_fund_balance;
drop view if exists public.member_activity;

create or replace view public.room_fund_balance
with (security_invoker = true) as
select
  r.id                                            as room_id,
  coalesce(c.total, 0)                            as total_contributions_cents,
  coalesce(mc.total, 0)                           as total_common_expenses_cents,
  coalesce(mp.total, 0)                           as total_personal_expenses_cents,
  coalesce(p.total, 0)                            as total_reimbursed_cents,
  -- Cash physically in the pot.
  coalesce(c.total, 0) - coalesce(mc.total, 0) - coalesce(p.total, 0)
                                                  as fund_cash_cents,
  -- Money owed out but not yet sent. Informational only: it is a liability of
  -- the room, not money that has left it, so it must not reduce the balance.
  --
  -- This is deliberately an inline subquery rather than a call to
  -- room_pending_liability_cents(). The view is SECURITY INVOKER, so every
  -- expression in it executes as the querying role, and that helper is revoked
  -- from `authenticated` in section 14. Calling it here would make the whole
  -- view fail with "permission denied". The definition is identical to the
  -- function's, which stays for the RPC paths that are gated on membership.
  coalesce(l.total, 0)                            as pending_liability_cents,
  coalesce(c.total, 0) - coalesce(mc.total, 0) - coalesce(p.total, 0)
                                                  as available_balance_cents
from public.rooms r
left join (
  select room_id, sum(amount_cents) as total
  from public.contributions
  where voided_at is null
  group by room_id
) c on c.room_id = r.id
left join (
  select room_id, sum(amount_cents) as total
  from public.expenses
  where voided_at is null
    and payment_source = 'common'
  group by room_id
) mc on mc.room_id = r.id
left join (
  select room_id, sum(amount_cents) as total
  from public.expenses
  where voided_at is null
    and payment_source = 'personal'
  group by room_id
) mp on mp.room_id = r.id
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
    and e.payment_source = 'personal'
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
  m.id                                            as member_id,
  m.room_id,
  m.display_name,
  m.role,
  m.status,
  coalesce(c.total, 0)                            as contributed_cents,
  coalesce(z.total, 0)                            as reimbursed_cents,
  coalesce(c.total, 0) - coalesce(z.total, 0)     as net_into_fund_cents,
  -- Everything this member paid for out of their own pocket, settled or not.
  coalesce(s.total, 0)                            as personal_spent_cents,
  -- The unsettled subset of the above: what the room still owes them.
  coalesce(p.total, 0)                            as pending_claim_cents
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
    and e.payment_source = 'personal'
  group by e.paid_by_member_id
) s on s.member_id = m.id
left join (
  select e.paid_by_member_id as member_id, sum(e.amount_cents) as total
  from public.expenses e
  where e.voided_at is null
    and e.payment_source = 'personal'
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
-- 12. PERIOD-SCOPED EXPORT
--
-- Read-only snapshot of one date range. Closed periods export normally: locking
-- history is exactly what makes it exportable afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.room_export(
  p_room    uuid,
  p_from    date,
  p_ends_on date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_room_member(p_room) then
    raise exception 'Not a member of this room';
  end if;

  if p_from is null or p_ends_on is null or p_ends_on < p_from then
    raise exception 'Invalid date range';
  end if;

  select * into v_room from public.rooms where id = p_room;
  if v_room.id is null then
    raise exception 'Room not found';
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'name', v_room.name,
      'currency', v_room.currency
    ),
    'range', jsonb_build_object('from', p_from, 'to', p_ends_on),
    'contributions', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.contributed_on)
      from (
        select c.id, c.member_id, m.display_name, c.amount_cents,
               c.contributed_on, c.method, c.note, c.voided_at, c.void_reason
        from public.contributions c
        join public.members m on m.id = c.member_id
        where c.room_id = p_room
          and c.contributed_on >= p_from
          and c.contributed_on <= p_ends_on
      ) t
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.spent_on)
      from (
        select e.id, e.paid_by_member_id, m.display_name as paid_by,
               e.description, e.amount_cents, e.payment_source, e.category,
               e.spent_on, e.note, e.voided_at, e.void_reason,
               z.status as reimbursement_status,
               z.paid_on  as reimbursed_on
        from public.expenses e
        join public.members m on m.id = e.paid_by_member_id
        left join lateral (
          select zz.status, zz.paid_on
          from public.reimbursements zz
          where zz.expense_id = e.id
            and zz.voided_at is null
          order by zz.requested_at desc
          limit 1
        ) z on true
        where e.room_id = p_room
          and e.spent_on >= p_from
          and e.spent_on <= p_ends_on
      ) t
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'contributions_cents', coalesce((
        select sum(c.amount_cents) from public.contributions c
        where c.room_id = p_room and c.voided_at is null
          and c.contributed_on >= p_from and c.contributed_on <= p_ends_on
      ), 0),
      'common_expenses_cents', coalesce((
        select sum(e.amount_cents) from public.expenses e
        where e.room_id = p_room and e.voided_at is null
          and e.payment_source = 'common'
          and e.spent_on >= p_from and e.spent_on <= p_ends_on
      ), 0),
      'personal_expenses_cents', coalesce((
        select sum(e.amount_cents) from public.expenses e
        where e.room_id = p_room and e.voided_at is null
          and e.payment_source = 'personal'
          and e.spent_on >= p_from and e.spent_on <= p_ends_on
      ), 0),
      'reimbursed_cents', coalesce((
        select sum(e.amount_cents)
        from public.reimbursements z
        join public.expenses e on e.id = z.expense_id
        where z.room_id = p_room and z.status = 'paid' and z.voided_at is null
          and e.voided_at is null
          and e.spent_on >= p_from and e.spent_on <= p_ends_on
      ), 0),
      'available_cents', public.room_available_cents(p_room),
      'pending_liability_cents', public.room_pending_liability_cents(p_room)
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 13. RLS
-- ---------------------------------------------------------------------------

alter table public.accounting_periods enable row level security;
alter table public.financial_audit_log enable row level security;

-- Periods and the audit trail are readable by every active member of the room.
-- Neither table has an INSERT/UPDATE/DELETE policy on purpose: every write goes
-- through a SECURITY DEFINER RPC that re-checks admin rights and writes a log
-- row, so a client can never quietly edit or erase history.
drop policy if exists accounting_periods_select on public.accounting_periods;
create policy accounting_periods_select on public.accounting_periods
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists financial_audit_log_select on public.financial_audit_log;
create policy financial_audit_log_select on public.financial_audit_log
  for select to authenticated
  using (public.is_room_member(room_id));

-- Expenses: a normal member may only log a PERSONAL expense for themselves.
-- Recording a common-fund expense is a treasurer action, so it is admin only.
-- Previously any member could insert payment_source = 'common' and spend the
-- shared pot.
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_room_member(room_id)
    and created_by_member_id = public.current_member_id(room_id)
    and created_by = auth.uid()
    and (
      public.is_room_admin(room_id)
      or (
        payment_source = 'personal'
        and paid_by_member_id = public.current_member_id(room_id)
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 14. GRANTS
-- ---------------------------------------------------------------------------

revoke all on public.accounting_periods, public.financial_audit_log from anon;
revoke all on public.room_fund_balance, public.member_activity from anon;

grant select on public.accounting_periods to authenticated;
grant select on public.financial_audit_log  to authenticated;
grant select on public.room_fund_balance    to authenticated;
grant select on public.member_activity      to authenticated;

-- Helpers stay internal.
revoke execute on function public.room_available_cents(uuid)          from public, anon, authenticated;
revoke execute on function public.room_pending_liability_cents(uuid) from public, anon, authenticated;
revoke execute on function public.assert_period_open(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.write_audit(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;

revoke execute on function public.correct_expense(uuid, text, integer, text, date, text, text, text) from public, anon;
revoke execute on function public.create_accounting_period(uuid, text, date, date)               from public, anon;
revoke execute on function public.close_accounting_period(uuid)                                  from public, anon;
revoke execute on function public.room_export(uuid, date, date)                                  from public, anon;
revoke execute on function public.mark_reimbursement_paid(uuid, text, text, date)               from public, anon;

grant execute on function public.correct_expense(uuid, text, integer, text, date, text, text, text) to authenticated;
grant execute on function public.create_accounting_period(uuid, text, date, date)                to authenticated;
grant execute on function public.close_accounting_period(uuid)                                   to authenticated;
grant execute on function public.room_export(uuid, date, date)                                   to authenticated;
grant execute on function public.mark_reimbursement_paid(uuid, text, text, date)                to authenticated;


-- ---------------------------------------------------------------------------
-- 15. REALTIME
-- ---------------------------------------------------------------------------

alter table public.accounting_periods replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['accounting_periods'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then
        null; -- already published
    end;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
as $$
declare
  v_exp    public.expenses;
  v_after  public.expenses;
  v_member uuid;
  v_reason text;
begin
  select * into v_exp from public.expenses where id = p_expense;
  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;

  if not public.is_room_admin(v_exp.room_id) then
    raise exception 'Only the admin can correct an expense';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 then
    raise exception 'A correction needs a reason of at least 3 characters';
  end if;

  if p_amount_cents is not null and p_amount_cents <= 0 then
    raise exception 'Amount must be greater than 0';
  end if;

  if p_payment_source is not null and p_payment_source not in ('common', 'personal') then
    raise exception 'Payment source must be common or personal';
  end if;

  if p_description is not null
     and char_length(trim(p_description)) not between 1 and 120 then
    raise exception 'Description must be 1 to 120 characters';
  end if;

  if p_category is not null
     and char_length(trim(p_category)) not between 1 and 40 then
    raise exception 'Category must be 1 to 40 characters';
  end if;

  -- A voided row is history. Editing it would leave an audit trail whose
  -- "after" state is a record nobody can see in the ledger, so require the
  -- expense to be live.
  if v_exp.voided_at is not null then
    raise exception 'This expense is voided; voided records cannot be corrected';
  end if;

  -- Every argument is nullable and means "leave this field alone", so an
  -- omitted argument can never silently erase data.
  if p_description   is null and p_amount_cents is null
     and p_category   is null and p_spent_on   is null
     and p_payment_source is null and p_note    is null then
    raise exception 'A correction must change at least one field';
  end if;

  -- The period guard and the active-reimbursement lock both fire on this UPDATE
  -- from their own triggers, so a correction can never rewrite closed history
  -- or alter an already-settled amount.
  update public.expenses
     set description    = coalesce(nullif(trim(p_description), ''), description),
         amount_cents   = coalesce(p_amount_cents, amount_cents),
         category       = coalesce(nullif(trim(p_category), ''), category),
         spent_on       = coalesce(p_spent_on, spent_on),
         payment_source = coalesce(p_payment_source, payment_source),
         note           = coalesce(p_note, note)
   where id = p_expense;

  select * into v_after from public.expenses where id = p_expense;

  v_member := public.current_member_id(v_exp.room_id);

  perform public.write_audit(
    v_exp.room_id, 'correct_expense', 'expense', p_expense,
    v_reason,
    jsonb_build_object(
      'before', to_jsonb(v_exp),
      'after',  to_jsonb(v_after)
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. REIMBURSEMENT SETTLEMENT
--
-- The old 3-argument overload is dropped, not superseded: leaving it callable
-- would be a back door that skips both the payment date and the funds check.
-- ---------------------------------------------------------------------------

revoke execute on function public.mark_reimbursement_paid(uuid, text, text)
  from public, anon, authenticated;
drop function if exists public.mark_reimbursement_paid(uuid, text, text);

create or replace function public.mark_reimbursement_paid(
  p_reimbursement uuid,
  p_method        text default null,
  p_reference     text default null,
  p_paid_on       date   default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r          public.reimbursements;
  v_exp        public.expenses;
  v_member     uuid;
  v_available  integer;
  v_paid_on    date;
begin
  if auth.uid() is null then
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

  v_paid_on := coalesce(p_paid_on, current_date);
  if v_paid_on > current_date then
    raise exception 'The payment date cannot be in the future';
  end if;

  select * into v_exp from public.expenses where id = v_r.expense_id;
  if v_exp.voided_at is not null then
    raise exception 'The expense behind this reimbursement is voided';
  end if;

  -- Settling a claim moves money out of the pot. Refuse when that would leave
  -- the fund negative: an overdrawn fund is a bookkeeping problem, not a
  -- payment the treasurer should be allowed to silently create.
  --
  -- The lock is taken before the balance is read: two treasurers settling two
  -- claims at the same time could otherwise both read the pre-payment balance,
  -- both pass the check, and overdraw the fund.
  perform pg_advisory_xact_lock(hashtext('settle:' || v_r.room_id::text));

  v_available := public.room_available_cents(v_r.room_id);

  if v_available < v_exp.amount_cents then
    raise exception
      'Not enough in the common fund: %. available, %. owed. Add a contribution before paying this.',
      (v_available / 100.0),
      (v_exp.amount_cents / 100.0);
  end if;

  v_member := public.current_member_id(v_r.room_id);

  update public.reimbursements
     set status            = 'paid',
         paid_at           = now(),
         paid_on           = v_paid_on,
         paid_by_member_id = v_member,
         method            = p_method,
         reference         = p_reference
   where id = p_reimbursement
     and status = 'pending';

  -- The advisory lock above serialises settlements per room, so losing this
  -- race is not expected; check anyway rather than audit-logging a payment
  -- that was never written.
  if not found then
    raise exception 'This reimbursement was paid by someone else';
  end if;

  perform public.write_audit(
    v_r.room_id, 'mark_reimbursement_paid', 'reimbursement', p_reimbursement,
    null,
    jsonb_build_object(
      'expense_id', v_exp.id,
      'amount_cents', v_exp.amount_cents,
      'paid_on', v_paid_on,
      'method', p_method,
      'reference', p_reference
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 10. VOIDS (now audited; period protection comes from the triggers above)
-- ---------------------------------------------------------------------------

create or replace function public.void_expense(p_expense uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp    public.expenses;
  v_member uuid;
  v_reason text;
begin
  select * into v_exp from public.expenses where id = p_expense;
  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;
  if v_exp.voided_at is not null then
    raise exception 'Expense is already voided';
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

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  update public.expenses
     set voided_at   = now(),
         void_reason = v_reason
   where id = p_expense
     and voided_at is null;

  perform public.write_audit(
    v_exp.room_id, 'void_expense', 'expense', p_expense,
    v_reason,
    jsonb_build_object('amount_cents', v_exp.amount_cents, 'spent_on', v_exp.spent_on)
  );
end;
$$;

create or replace function public.void_contribution(p_contribution uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      public.contributions;
  v_reason text;
begin
  select * into v_c from public.contributions where id = p_contribution;
  if v_c.id is null then
    raise exception 'Contribution not found';
  end if;
  if v_c.voided_at is not null then
    raise exception 'Contribution is already voided';
  end if;

  if not public.is_room_admin(v_c.room_id) then
    raise exception 'Only the admin can void contributions';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  update public.contributions
     set voided_at   = now(),
         void_reason = v_reason
   where id = p_contribution
     and voided_at is null;

  perform public.write_audit(
    v_c.room_id, 'void_contribution', 'contribution', p_contribution,
    v_reason,
    jsonb_build_object('amount_cents', v_c.amount_cents, 'contributed_on', v_c.contributed_on)
  );
end;
$$;

create or replace function public.void_reimbursement(p_reimbursement uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reimbursements;
  v_reason text;
  v_amount integer;
begin
  select * into v_r from public.reimbursements where id = p_reimbursement;
  if v_r.id is null then
    raise exception 'Reimbursement not found';
  end if;
  if v_r.voided_at is not null then
    raise exception 'Reimbursement is already voided';
  end if;

  if not public.is_room_admin(v_r.room_id) then
    raise exception 'Only the admin can void reimbursements';
  end if;

  select e.amount_cents into v_amount
    from public.expenses e where e.id = v_r.expense_id;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  update public.reimbursements
     set voided_at   = now(),
         void_reason = v_reason
   where id = p_reimbursement
     and voided_at is null;

  perform public.write_audit(
    v_r.room_id, 'void_reimbursement', 'reimbursement', p_reimbursement,
    v_reason,
    jsonb_build_object(
      'expense_id', v_r.expense_id,
      'amount_cents', v_amount,
      'was_paid', v_r.status = 'paid'
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 11. CORRECTED VIEWS
--
-- create or replace cannot add columns to an existing view, so these are
-- dropped and recreated. Nothing depends on them.
-- ---------------------------------------------------------------------------

drop view if exists public.room_fund_balance;
drop view if exists public.member_activity;

create or replace view public.room_fund_balance
with (security_invoker = true) as
select
  r.id                                            as room_id,
  coalesce(c.total, 0)                            as total_contributions_cents,
  coalesce(mc.total, 0)                           as total_common_expenses_cents,
  coalesce(mp.total, 0)                           as total_personal_expenses_cents,
  coalesce(p.total, 0)                            as total_reimbursed_cents,
  -- Cash physically in the pot.
  coalesce(c.total, 0) - coalesce(mc.total, 0) - coalesce(p.total, 0)
                                                  as fund_cash_cents,
  -- Money owed out but not yet sent. Informational only: it is a liability of
  -- the room, not money that has left it, so it must not reduce the balance.
  --
  -- This is deliberately an inline subquery rather than a call to
  -- room_pending_liability_cents(). The view is SECURITY INVOKER, so every
  -- expression in it executes as the querying role, and that helper is revoked
  -- from `authenticated` in section 14. Calling it here would make the whole
  -- view fail with "permission denied". The definition is identical to the
  -- function's, which stays for the RPC paths that are gated on membership.
  coalesce(l.total, 0)                            as pending_liability_cents,
  coalesce(c.total, 0) - coalesce(mc.total, 0) - coalesce(p.total, 0)
                                                  as available_balance_cents
from public.rooms r
left join (
  select room_id, sum(amount_cents) as total
  from public.contributions
  where voided_at is null
  group by room_id
) c on c.room_id = r.id
left join (
  select room_id, sum(amount_cents) as total
  from public.expenses
  where voided_at is null
    and payment_source = 'common'
  group by room_id
) mc on mc.room_id = r.id
left join (
  select room_id, sum(amount_cents) as total
  from public.expenses
  where voided_at is null
    and payment_source = 'personal'
  group by room_id
) mp on mp.room_id = r.id
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
    and e.payment_source = 'personal'
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
  m.id                                            as member_id,
  m.room_id,
  m.display_name,
  m.role,
  m.status,
  coalesce(c.total, 0)                            as contributed_cents,
  coalesce(z.total, 0)                            as reimbursed_cents,
  coalesce(c.total, 0) - coalesce(z.total, 0)     as net_into_fund_cents,
  -- Everything this member paid for out of their own pocket, settled or not.
  coalesce(s.total, 0)                            as personal_spent_cents,
  -- The unsettled subset of the above: what the room still owes them.
  coalesce(p.total, 0)                            as pending_claim_cents
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
    and e.payment_source = 'personal'
  group by e.paid_by_member_id
) s on s.member_id = m.id
left join (
  select e.paid_by_member_id as member_id, sum(e.amount_cents) as total
  from public.expenses e
  where e.voided_at is null
    and e.payment_source = 'personal'
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
-- 12. PERIOD-SCOPED EXPORT
--
-- Read-only snapshot of one date range. Closed periods export normally: locking
-- history is exactly what makes it exportable afterwards.
-- ---------------------------------------------------------------------------

create or replace function public.room_export(
  p_room    uuid,
  p_from    date,
  p_ends_on date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_room_member(p_room) then
    raise exception 'Not a member of this room';
  end if;

  if p_from is null or p_ends_on is null or p_ends_on < p_from then
    raise exception 'Invalid date range';
  end if;

  select * into v_room from public.rooms where id = p_room;
  if v_room.id is null then
    raise exception 'Room not found';
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'name', v_room.name,
      'currency', v_room.currency
    ),
    'range', jsonb_build_object('from', p_from, 'to', p_ends_on),
    'contributions', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.contributed_on)
      from (
        select c.id, c.member_id, m.display_name, c.amount_cents,
               c.contributed_on, c.method, c.note, c.voided_at, c.void_reason
        from public.contributions c
        join public.members m on m.id = c.member_id
        where c.room_id = p_room
          and c.contributed_on >= p_from
          and c.contributed_on <= p_ends_on
      ) t
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.spent_on)
      from (
        select e.id, e.paid_by_member_id, m.display_name as paid_by,
               e.description, e.amount_cents, e.payment_source, e.category,
               e.spent_on, e.note, e.voided_at, e.void_reason,
               z.status as reimbursement_status,
               z.paid_on  as reimbursed_on
        from public.expenses e
        join public.members m on m.id = e.paid_by_member_id
        left join lateral (
          select zz.status, zz.paid_on
          from public.reimbursements zz
          where zz.expense_id = e.id
            and zz.voided_at is null
          order by zz.requested_at desc
          limit 1
        ) z on true
        where e.room_id = p_room
          and e.spent_on >= p_from
          and e.spent_on <= p_ends_on
      ) t
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'contributions_cents', coalesce((
        select sum(c.amount_cents) from public.contributions c
        where c.room_id = p_room and c.voided_at is null
          and c.contributed_on >= p_from and c.contributed_on <= p_ends_on
      ), 0),
      'common_expenses_cents', coalesce((
        select sum(e.amount_cents) from public.expenses e
        where e.room_id = p_room and e.voided_at is null
          and e.payment_source = 'common'
          and e.spent_on >= p_from and e.spent_on <= p_ends_on
      ), 0),
      'personal_expenses_cents', coalesce((
        select sum(e.amount_cents) from public.expenses e
        where e.room_id = p_room and e.voided_at is null
          and e.payment_source = 'personal'
          and e.spent_on >= p_from and e.spent_on <= p_ends_on
      ), 0),
      'reimbursed_cents', coalesce((
        select sum(e.amount_cents)
        from public.reimbursements z
        join public.expenses e on e.id = z.expense_id
        where z.room_id = p_room and z.status = 'paid' and z.voided_at is null
          and e.voided_at is null
          and e.spent_on >= p_from and e.spent_on <= p_ends_on
      ), 0),
      'available_cents', public.room_available_cents(p_room),
      'pending_liability_cents', public.room_pending_liability_cents(p_room)
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 13. RLS
-- ---------------------------------------------------------------------------

alter table public.accounting_periods enable row level security;
alter table public.financial_audit_log enable row level security;

-- Periods and the audit trail are readable by every active member of the room.
-- Neither table has an INSERT/UPDATE/DELETE policy on purpose: every write goes
-- through a SECURITY DEFINER RPC that re-checks admin rights and writes a log
-- row, so a client can never quietly edit or erase history.
drop policy if exists accounting_periods_select on public.accounting_periods;
create policy accounting_periods_select on public.accounting_periods
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists financial_audit_log_select on public.financial_audit_log;
create policy financial_audit_log_select on public.financial_audit_log
  for select to authenticated
  using (public.is_room_member(room_id));

-- Expenses: a normal member may only log a PERSONAL expense for themselves.
-- Recording a common-fund expense is a treasurer action, so it is admin only.
-- Previously any member could insert payment_source = 'common' and spend the
-- shared pot.
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_room_member(room_id)
    and created_by_member_id = public.current_member_id(room_id)
    and created_by = auth.uid()
    and (
      public.is_room_admin(room_id)
      or (
        payment_source = 'personal'
        and paid_by_member_id = public.current_member_id(room_id)
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 14. GRANTS
-- ---------------------------------------------------------------------------

revoke all on public.accounting_periods, public.financial_audit_log from anon;
revoke all on public.room_fund_balance, public.member_activity from anon;

grant select on public.accounting_periods to authenticated;
grant select on public.financial_audit_log  to authenticated;
grant select on public.room_fund_balance    to authenticated;
grant select on public.member_activity      to authenticated;

-- Helpers stay internal.
revoke execute on function public.room_available_cents(uuid)          from public, anon, authenticated;
revoke execute on function public.room_pending_liability_cents(uuid) from public, anon, authenticated;
revoke execute on function public.assert_period_open(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.write_audit(uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;

revoke execute on function public.correct_expense(uuid, text, integer, text, date, text, text, text) from public, anon;
revoke execute on function public.create_accounting_period(uuid, text, date, date)               from public, anon;
revoke execute on function public.close_accounting_period(uuid)                                  from public, anon;
revoke execute on function public.room_export(uuid, date, date)                                  from public, anon;
revoke execute on function public.mark_reimbursement_paid(uuid, text, text, date)               from public, anon;

grant execute on function public.correct_expense(uuid, text, integer, text, date, text, text, text) to authenticated;
grant execute on function public.create_accounting_period(uuid, text, date, date)                to authenticated;
grant execute on function public.close_accounting_period(uuid)                                   to authenticated;
grant execute on function public.room_export(uuid, date, date)                                   to authenticated;
grant execute on function public.mark_reimbursement_paid(uuid, text, text, date)                to authenticated;


-- ---------------------------------------------------------------------------
-- 15. REALTIME
-- ---------------------------------------------------------------------------

alter table public.accounting_periods replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['accounting_periods'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then
        null; -- already published
    end;
  end loop;
end;
$$;

notify pgrst, 'reload schema';