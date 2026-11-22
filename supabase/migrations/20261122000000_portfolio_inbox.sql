-- Private portfolio inbox. No anon or authenticated direct table policies exist.
create table if not exists public.portfolio_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sender_email text not null check (length(sender_email) between 3 and 254),
  subject text not null check (length(subject) between 3 and 120),
  body text not null check (length(body) between 10 and 5000),
  state text not null default 'unread' check (state in ('unread','read','archived'))
);
create index if not exists portfolio_messages_created_at_idx on public.portfolio_messages (created_at desc);
create index if not exists portfolio_messages_state_idx on public.portfolio_messages (state, created_at desc);
alter table public.portfolio_messages enable row level security;
revoke all on public.portfolio_messages from anon, authenticated;

-- At most one generic email alert per 15-minute slot.
create table if not exists public.portfolio_alert_slots (
  slot timestamptz primary key,
  created_at timestamptz not null default now()
);
alter table public.portfolio_alert_slots enable row level security;
revoke all on public.portfolio_alert_slots from anon, authenticated;
