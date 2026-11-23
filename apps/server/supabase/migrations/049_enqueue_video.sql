-- Saving a YouTube link in one trip to the database.
--
-- The server used to make these calls one after another while the person who
-- shared the link waited: is it queued already, what plan are they on, their
-- summary language, count it against the month, insert the row, and (for the
-- queue screen) count what is ahead. This function does the same work, by the
-- same rules, in a single call.
--
-- Returns one of:
--   {"outcome": "duplicate"}                          queued within the window
--   {"outcome": "limited", "limit": n, "plan": "…"}   month and wallet used up
--   {"outcome": "ok", "row": {…clip…}, "position": n}
--
-- p_limits is the plan table from the server ({"free": 5, "pro": 100}), so the
-- numbers stay in one place (PLAN_LIMITS in @cliphy/shared).

create or replace function public.enqueue_video(
  p_user_id uuid,
  p_video_id text,
  p_video_url text,
  p_video_title text,
  p_video_channel text,
  p_duration_seconds integer,
  p_limits jsonb,
  p_window_seconds integer,
  p_want_position boolean default false
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_plan text;
  v_bonus integer;
  v_limit integer;
  v_language text;
  v_row public.clips;
  v_position integer := 1;
begin
  -- Same user, same video, still active, queued within the window: the share
  -- sheet firing twice, not a wish to summarize it again.
  if exists (
    select 1
    from public.clips
    where user_id = p_user_id
      and youtube_video_id = p_video_id
      and status <> 'failed'
      and deleted_at is null
      and created_at >= now() - make_interval(secs => p_window_seconds)
  ) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  select plan, monthly_limit_bonus
  into v_plan, v_bonus
  from public.users
  where id = p_user_id;
  v_plan := coalesce(v_plan, 'free');
  -- Effective monthly cap = plan limit + recurring admin bonus.
  v_limit := coalesce((p_limits ->> v_plan)::integer, (p_limits ->> 'free')::integer)
    + coalesce(v_bonus, 0);

  select summary_language
  into v_language
  from public.user_settings
  where user_id = p_user_id;

  -- The count and the insert stand or fall together: if the insert loses a
  -- race to a concurrent share of the same video (the unique index on user,
  -- video and bucket), the count taken just above is undone with it.
  begin
    if not public.increment_monthly_count(p_user_id, v_limit) then
      return jsonb_build_object('outcome', 'limited', 'limit', v_limit, 'plan', v_plan);
    end if;

    insert into public.clips (
      user_id,
      youtube_video_id,
      video_title,
      video_channel,
      video_duration_seconds,
      video_url,
      summary_language,
      status,
      dedup_bucket
    )
    values (
      p_user_id,
      p_video_id,
      nullif(p_video_title, ''),
      nullif(p_video_channel, ''),
      p_duration_seconds,
      p_video_url,
      coalesce(v_language, 'en'),
      'pending',
      floor(extract(epoch from now()) / p_window_seconds)::bigint
    )
    returning * into v_row;
  exception
    when unique_violation then
      return jsonb_build_object('outcome', 'duplicate');
  end;

  -- Items of this user's still waiting that were queued before this one.
  if p_want_position then
    select count(*) + 1
    into v_position
    from public.clips
    where user_id = p_user_id
      and status in ('pending', 'processing')
      and created_at < v_row.created_at;
  end if;

  return jsonb_build_object('outcome', 'ok', 'row', to_jsonb(v_row), 'position', v_position);
end;
$$;

comment on function public.enqueue_video is
  'Queue a YouTube video for a summary in one call: windowed duplicate check, monthly limit (plan + bonus, then the credit wallet), insert, and optionally the queue position.';

-- Called by the API server only.
revoke all on function public.enqueue_video(
  uuid, text, text, text, text, integer, jsonb, integer, boolean
) from public, anon, authenticated;
grant execute on function public.enqueue_video(
  uuid, text, text, text, text, integer, jsonb, integer, boolean
) to service_role;
