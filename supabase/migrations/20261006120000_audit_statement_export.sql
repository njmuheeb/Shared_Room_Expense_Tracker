-- =============================================================================
-- Audit log entry for statement generation & digital approval
-- =============================================================================

-- Ensure write_audit helper supports recording statement audit entries safely
-- write_audit already inserts into financial_audit_log.
-- We can add a specialized helper RPC for auditing statement export / digital approval
-- if desired, or let the application call write_audit.

create or replace function public.audit_statement_export(
  p_room         uuid,
  p_action       text,
  p_statement_id text,
  p_period_name  text,
  p_starts_on    text,
  p_ends_on      text,
  p_is_approved  boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  v_member := public.current_member_id(p_room);
  if v_member is null then
    raise exception 'Not a member of this room';
  end if;

  perform public.write_audit(
    p_room,
    p_action,
    'statement',
    null,
    p_period_name,
    jsonb_build_object(
      'statement_id', p_statement_id,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on,
      'digitally_approved', p_is_approved,
      'exported_at', now()
    )
  );
end;
$$;

revoke execute on function public.audit_statement_export(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.audit_statement_export(uuid, text, text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
