-- Store transcript text on the summary row so Inngest retries
-- don't need to re-fetch from YouTube (which fails from datacenter IPs).
ALTER TABLE summaries ADD COLUMN transcript text;
