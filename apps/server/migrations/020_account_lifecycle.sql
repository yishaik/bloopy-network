-- Self-service export, creature reset and account deletion (#56) plus share referrals (#55).

-- Audit trail for lifecycle actions. Deliberately holds no player identifier: the account row is
-- gone after a deletion, so a reversible link would defeat the deletion it records.
CREATE TABLE account_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('data_exported','creature_reset','account_deleted')),
  subject_ref text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_lifecycle_events_recent_idx ON account_lifecycle_events(created_at DESC,event_type);

-- game_events keys off creatures(id) without a foreign key, so creature deletion has to sweep it
-- explicitly. The index keeps that sweep and the existing aggregate reads cheap.
CREATE INDEX IF NOT EXISTS game_events_aggregate_only_idx ON game_events(aggregate_id);

-- telegram_updates stores raw Telegram payloads, which carry the sender's identity. Deletion has to
-- find every update a given Telegram user produced.
CREATE INDEX IF NOT EXISTS telegram_updates_sender_idx
  ON telegram_updates(((payload->'message'->'from'->>'id')));

-- One attribution row per referred player: the unique constraint is what makes referral rewards
-- one-time and reset-proof. The row keys off the durable player rather than the creature, and it
-- outlives the referrer's own creature, so neither side can reset their way to a second payout.
CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_creature_id uuid REFERENCES creatures(id) ON DELETE SET NULL,
  referred_player_id uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'meet_link',
  rewarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz
);
CREATE INDEX referrals_referrer_idx ON referrals(referrer_creature_id,created_at DESC);

-- A reset must not hand the same player a fresh set of first-time referral rewards, so the count of
-- lifetime creatures per player is tracked on the durable account row.
ALTER TABLE players ADD COLUMN IF NOT EXISTS creature_generation integer NOT NULL DEFAULT 1;

-- The existing slug embeds the owner's Telegram user id, which is fine for a link one player hands
-- to another but not for a page anyone can open. Public share surfaces key off this opaque token
-- instead. Backfilled for every creature so no row is ever un-shareable.
ALTER TABLE creatures ADD COLUMN IF NOT EXISTS share_token text;
UPDATE creatures SET share_token=encode(gen_random_bytes(9),'hex') WHERE share_token IS NULL;
ALTER TABLE creatures ALTER COLUMN share_token SET NOT NULL;
ALTER TABLE creatures ALTER COLUMN share_token SET DEFAULT encode(gen_random_bytes(9),'hex');
CREATE UNIQUE INDEX creatures_share_token_idx ON creatures(share_token);
