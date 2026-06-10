-- Liked-videos auto-subscription: poll videos.list?myRating=like with user OAuth token
alter type public.subscription_type add value if not exists 'liked';
