-- Which client initiated the Google OAuth flow — drives the callback redirect
-- (web → web app URL, mobile → com.cliphy.app:// deep link)
alter table public.oauth_states
  add column platform text not null default 'web';
