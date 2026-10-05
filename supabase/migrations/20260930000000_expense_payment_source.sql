-- ============================================================
-- Shared Room Expense Tracker
-- Step 1: Distinguish common-fund expenses from personal expenses
-- ============================================================

-- ------------------------------------------------------------
-- 1. Add payment_source to expenses
--
-- common  = paid directly from the shared room fund
-- personal = paid by a member from their own money
-- ------------------------------------------------------------

alter table public.expenses
  add column if not exists payment_source text
  not null default 'personal'
  check (payment_source in ('common', 'personal'));


-- ------------------------------------------------------------
-- 2. Existing expenses
--
-- The old application treated expenses as out-of-pocket /
-- reimbursable expenses, so existing records are safest to
-- classify as personal.
--
-- New common-fund expenses will explicitly use:
-- payment_source = 'common'
-- ------------------------------------------------------------

update public.expenses
set payment_source = 'personal'
where payment_source is null;


-- ------------------------------------------------------------
-- 3. Add an index for balance calculations
-- ------------------------------------------------------------

create index if not exists expenses_room_payment_source_idx
  on public.expenses (room_id, payment_source)
  where voided_at is null;


-- ------------------------------------------------------------
-- 4. Protect the relationship between payment source
--    and reimbursement requests.
--
-- A common-fund expense must NEVER receive a reimbursement.
-- A personal expense can be reimbursed.
-- ------------------------------------------------------------

create or replace function public.validate_expense_reimbursement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_source text;
begin

  select e.payment_source
    into v_payment_source
  from public.expenses e
  where e.id = new.expense_id
    and e.voided_at is null;

  if v_payment_source is null then
    raise exception 'Expense not found or already voided';
  end if;

  if v_payment_source <> 'personal' then
    raise exception
      'Only expenses paid with personal money can be reimbursed';
  end if;

  return new;
end;
$$;


drop trigger if exists trg_validate_expense_reimbursement
on public.reimbursements;

create trigger trg_validate_expense_reimbursement
before insert or update on public.reimbursements
for each row
execute function public.validate_expense_reimbursement();


-- ------------------------------------------------------------
-- 5. Update request_reimbursement()
--
-- Only personal expenses are eligible.
-- ------------------------------------------------------------

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

  select *
    into v_exp
  from public.expenses
  where id = p_expense;

  if v_exp.id is null then
    raise exception 'Expense not found';
  end if;

  if v_exp.voided_at is not null then
    raise exception 'Expense is voided';
  end if;

  if v_exp.payment_source <> 'personal' then
    raise exception
      'Only expenses paid with personal money can be reimbursed';
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

  if v_exp.paid_by_member_id <> v_member
     and not public.is_room_admin(v_exp.room_id)
  then
    raise exception
      'Only the payer or the admin can request reimbursement';
  end if;

  if exists (
    select 1
    from public.reimbursements z
    where z.expense_id = p_expense
      and z.voided_at is null
  ) then
    raise exception
      'This expense already has an active reimbursement';
  end if;

  insert into public.reimbursements
    (
      expense_id,
      room_id,
      payee_member_id,
      status,
      requested_by_member_id
    )
  values
    (
      p_expense,
      v_exp.room_id,
      v_exp.paid_by_member_id,
      'pending',
      v_member
    )
  returning id into v_id;

  return v_id;
end;
$$;


-- ------------------------------------------------------------
-- 6. Grant the updated RPC to authenticated users
-- ------------------------------------------------------------

revoke execute
on function public.request_reimbursement(uuid)
from public, anon;

grant execute
on function public.request_reimbursement(uuid)
to authenticated;


-- ------------------------------------------------------------
-- 7. Refresh PostgREST schema cache
-- ------------------------------------------------------------

notify pgrst, 'reload schema';