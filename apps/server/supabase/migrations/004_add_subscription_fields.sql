-- Add Stripe subscription tracking fields to users table

alter table public.users
  add column stripe_subscription_id text unique,
  add column subscription_status text not null default 'none',
  add column trial_ends_at timestamptz;

comment on column public.users.stripe_subscription_id is
  'Stripe subscription ID. Set when user subscribes to Pro.';
comment on column public.users.subscription_status is
  'Stripe subscription status: none, active, trialing, past_due, canceled, unpaid.';
comment on column public.users.trial_ends_at is
  'When the trial period ends. NULL if no trial.';
