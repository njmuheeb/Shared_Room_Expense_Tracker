-- =============================================================================
-- Open-Ended Accounting Periods
--
-- Changes the accounting-period workflow so that:
--   * start_date is required when creating a period.
--   * end_date is NULL while the period is OPEN.
--   * Closing the period auto-sets end_date = current_date.
--   * Transaction validation for an OPEN period only checks >= starts_on.
--   * Transaction validation for a CLOSED period checks starts_on..ends_on.
--
-- This migration is additive and safe:
--   * No data is dropped or deleted.
--   * Existing closed periods keep their ends_on values.
--   * Existing open periods (if any) get ends_on set to NULL.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. MAKE ends_on NULLABLE
-- ---------------------------------------------------------------------------

-- Drop the old range check that assumed ends_on is always present.
alter table public.accounting_periods
  drop constraint if exists accounting_periods_range;

-- Allow NULL for ends_on.
alter table public.accounting_periods
  alter column ends_on drop not null;

-- Re-add the range check: only enforced when both dates are present (closed).
alter table public.accounting_periods
  add constraint accounting_periods_range
    check (ends_on is null or ends_on >= starts_on);

-- Update any existing OPEN periods to have NULL ends_on.
update public.accounting_periods
   set ends_on = null
 where status = 'open';


-- ---------------------------------------------------------------------------
-- 2. UPDATE CLOSE-FIELDS CONSTRAINT
--
-- An open period: ends_on IS NULL, closed_at IS NULL, closed_by IS NULL.
-- A closed period: ends_on IS NOT NULL, closed_at IS NOT NULL, closed_by IS NOT NULL.
-- ---------------------------------------------------------------------------

alter table public.accounting_periods
  drop constraint if exists accounting_periods_close_fields;

alter table public.accounting_periods
  add constraint accounting_periods_close_fields check (
    (status = 'open'   and ends_on is null     and closed_at is null     and closed_by_member_id is null)
    or
    (status = 'closed' and ends_on is not null and closed_at is not null and closed_by_member_id is not null)
  );


-- ---------------------------------------------------------------------------
-- 3. UPDATE assert_period_open()
--
-- For CLOSED periods: transaction must be >= starts_on AND <= ends_on.
-- For OPEN periods: we do NOT block — the period is still accepting changes.
-- Only CLOSED periods guard against writes.
-- ---------------------------------------------------------------------------

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

  -- Only CLOSED periods block writes. An open period (ends_on IS NULL) never
  -- blocks because it is still accepting transactions.
  select * into v_period
    from public.accounting_periods ap
   where ap.room_id = p_room
     and ap.status = 'closed'
     and ap.ends_on is not null
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


-- ---------------------------------------------------------------------------
-- 4. UPDATE create_accounting_period()
--
-- p_ends_on is now optional (defaults to NULL).
-- An open period is created with ends_on = NULL.
-- Overlap checking accounts for NULL ends_on (open-ended ranges).
-- ---------------------------------------------------------------------------

-- Drop the old function signature first so we can create the new one.
-- The old signature was (uuid, text, date, date) — we keep the same name
-- but change the parameter default.
create or replace function public.create_accounting_period(
  p_room      uuid,
  p_name      text,
  p_starts_on date,
  p_ends_on   date default null
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

  if p_starts_on is null then
    raise exception 'Start date is required';
  end if;

  -- If an explicit end date is given, it must not precede the start date.
  if p_ends_on is not null and p_ends_on < p_starts_on then
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

  -- Overlap check. An open period (ends_on IS NULL) is treated as extending
  -- to infinity for overlap purposes against closed periods.
  -- A new period with p_ends_on = NULL overlaps any existing period whose
  -- starts_on >= p_starts_on or whose ends_on >= p_starts_on.
  -- A new period with p_ends_on set overlaps any existing period whose range
  -- intersects [p_starts_on, p_ends_on].
  select * into v_clash
    from public.accounting_periods
   where room_id = p_room
     and (
       -- Case 1: existing has ends_on (closed). New may or may not have ends_on.
       (ends_on is not null
         and p_starts_on <= ends_on
         and (p_ends_on is null or p_ends_on >= starts_on)
       )
       or
       -- Case 2: existing has no ends_on (open — should not happen since we
       -- just checked, but guard against data races).
       (ends_on is null
         and (p_ends_on is null or p_ends_on >= starts_on)
       )
     )
   order by starts_on
   limit 1;

  if v_clash.id is not null then
    raise exception
      'That range overlaps the existing period "%" (% to %)',
      v_clash.name, v_clash.starts_on, coalesce(v_clash.ends_on::text, 'open');
  end if;

  -- Insert with ends_on = NULL (open period).
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


-- ---------------------------------------------------------------------------
-- 5. UPDATE close_accounting_period()
--
-- Now auto-sets ends_on = current_date when closing.
-- The pending-reimbursement and overdrawn checks use starts_on..current_date
-- for the boundary of the period being closed (since ends_on is NULL while open).
-- ---------------------------------------------------------------------------

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
  v_end_date date;
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

  -- The end date is the current database date (server clock, not user input).
  v_end_date := current_date;

  -- Safety: end date must not be before start date.
  if v_end_date < v_p.starts_on then
    raise exception
      'Cannot close this period: the current date (%) is before the period start date (%)',
      v_end_date, v_p.starts_on;
  end if;

  -- Refuse to close a period that still holds unsettled claims: settling them
  -- afterwards would be rejected by the period guard and freeze the liability.
  -- For an open period, we check transactions from starts_on to v_end_date.
  select count(*)::integer into v_pending
    from public.reimbursements z
    join public.expenses e on e.id = z.expense_id
   where z.room_id = v_p.room_id
     and z.status = 'pending'
     and z.voided_at is null
     and e.voided_at is null
     and e.spent_on >= v_p.starts_on
     and e.spent_on <= v_end_date;

  if v_pending > 0 then
    raise exception
      'This period still has % unsettled reimbursement(s). Settle or void them before closing.',
      v_pending;
  end if;

  -- Refuse to close a period where the fund ran overdrawn within the period range.
  select
      coalesce((select sum(c.amount_cents)
                  from public.contributions c
                 where c.room_id = v_p.room_id
                   and c.voided_at is null
                   and c.contributed_on >= v_p.starts_on
                   and c.contributed_on <= v_end_date), 0)
    - coalesce((select sum(e.amount_cents)
                  from public.expenses e
                 where e.room_id = v_p.room_id
                   and e.voided_at is null
                   and e.payment_source = 'common'
                   and e.spent_on >= v_p.starts_on
                   and e.spent_on <= v_end_date), 0)
    - coalesce((select sum(e.amount_cents)
                  from public.reimbursements z
                  join public.expenses e on e.id = z.expense_id
                 where z.room_id = v_p.room_id
                   and z.status = 'paid'
                   and z.voided_at is null
                   and e.voided_at is null
                   and e.spent_on >= v_p.starts_on
                   and e.spent_on <= v_end_date), 0)
  into v_net;

  if v_net < 0 then
    raise exception
      'This period is overdrawn by %. Closing it would lock in a shortfall; add the missing contribution first.',
      (v_net / 100.0);
  end if;

  -- Atomically close: set ends_on, status, closed_at, closed_by.
  update public.accounting_periods
     set ends_on             = v_end_date,
         status              = 'closed',
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
    jsonb_build_object('starts_on', v_p.starts_on, 'ends_on', v_end_date, 'net_cents', v_net)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. REFRESH GRANTS
--
-- The function signature changed (p_ends_on now has a default), so re-grant.
-- ---------------------------------------------------------------------------

revoke execute on function public.create_accounting_period(uuid, text, date, date) from public, anon;
grant execute on function public.create_accounting_period(uuid, text, date, date) to authenticated;

revoke execute on function public.close_accounting_period(uuid) from public, anon;
grant execute on function public.close_accounting_period(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. RELOAD PostgREST SCHEMA CACHE
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
