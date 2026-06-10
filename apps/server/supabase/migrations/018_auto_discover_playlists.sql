-- Toggle for auto-subscribing the user's own playlists named "Cliphy" (default on)
alter table public.user_settings
  add column auto_discover_playlists boolean not null default true;
