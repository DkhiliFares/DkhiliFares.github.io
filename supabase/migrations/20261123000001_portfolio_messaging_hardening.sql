alter table public.portfolio_messages
  add column if not exists sender_name text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portfolio_messages_sender_name_length'
      and conrelid = 'public.portfolio_messages'::regclass
  ) then
    alter table public.portfolio_messages
      add constraint portfolio_messages_sender_name_length
      check (length(sender_name) between 0 and 80);
  end if;
end;
$$;

create table if not exists public.portfolio_message_rate_limits (
  rate_key text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 5),
  updated_at timestamptz not null default now()
);
create index if not exists portfolio_message_rate_limits_updated_at_idx
  on public.portfolio_message_rate_limits (updated_at);
alter table public.portfolio_message_rate_limits enable row level security;
revoke all on public.portfolio_message_rate_limits from anon, authenticated;

create or replace function public.consume_portfolio_message_rate_limit(
  p_rate_key text,
  p_window_start timestamptz,
  p_max_requests integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  accepted_count integer;
begin
  if p_rate_key !~ '^[0-9a-f]{64}$'
    or p_max_requests < 1
    or p_max_requests > 5
    or p_window_start > now()
    or p_window_start < now() - interval '15 minutes' then
    raise exception 'Invalid rate-limit arguments';
  end if;

  insert into public.portfolio_message_rate_limits (rate_key, window_start, request_count, updated_at)
  values (p_rate_key, p_window_start, 1, now())
  on conflict (rate_key) do update
  set window_start = case
        when portfolio_message_rate_limits.window_start < excluded.window_start then excluded.window_start
        else portfolio_message_rate_limits.window_start
      end,
      request_count = case
        when portfolio_message_rate_limits.window_start < excluded.window_start then 1
        else portfolio_message_rate_limits.request_count + 1
      end,
      updated_at = now()
  where portfolio_message_rate_limits.window_start < excluded.window_start
     or (portfolio_message_rate_limits.window_start = excluded.window_start
         and portfolio_message_rate_limits.request_count < p_max_requests)
  returning request_count into accepted_count;

  delete from public.portfolio_message_rate_limits
  where updated_at < now() - interval '24 hours';

  return accepted_count is not null;
end;
$$;

revoke all on function public.consume_portfolio_message_rate_limit(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_portfolio_message_rate_limit(text, timestamptz, integer) to service_role;
