ALTER TABLE memories
  ADD COLUMN tier text NOT NULL DEFAULT 'episodic',
  ADD COLUMN source_version text NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN privacy_level text NOT NULL DEFAULT 'private',
  ADD COLUMN confidence real NOT NULL DEFAULT 1,
  ADD COLUMN canonical_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN world_id text NOT NULL DEFAULT 'bloopy-origin',
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN corrected_from_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE memories SET
  tier=CASE WHEN source_type='genesis' THEN 'identity' WHEN source_type='world' THEN 'world' ELSE 'episodic' END,
  source_version=CASE WHEN source_type='genesis' THEN 'character-genesis-v1' WHEN source_type='story_arc' THEN 'impossible-door-v1' ELSE 'legacy-v1' END,
  privacy_level=CASE WHEN is_private THEN 'private' ELSE 'shared' END
WHERE source_version='legacy-v1';

ALTER TABLE memories
  ADD CONSTRAINT memories_tier_check CHECK (tier IN ('working','episodic','identity','world')),
  ADD CONSTRAINT memories_privacy_check CHECK (privacy_level IN ('private','shared')),
  ADD CONSTRAINT memories_confidence_check CHECK (confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT memories_canonical_check CHECK (canonical_status IN ('approved','user_asserted','superseded','rejected'));

CREATE INDEX memories_active_context_idx
  ON memories(creature_id,world_id,tier,importance DESC,created_at DESC)
  WHERE deleted_at IS NULL AND canonical_status IN ('approved','user_asserted');
CREATE UNIQUE INDEX memories_one_correction_idx
  ON memories(corrected_from_id)
  WHERE corrected_from_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE memory_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','corrected','deleted','used')),
  actor_type text NOT NULL CHECK (actor_type IN ('engine','player','admin')),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_audit_creature_idx ON memory_audit_events(creature_id,created_at DESC);

CREATE TABLE personality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_type text NOT NULL,
  trait_deltas jsonb NOT NULL,
  personality_before jsonb NOT NULL,
  personality_after jsonb NOT NULL,
  mood_before text NOT NULL,
  mood_after text NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creature_id,source_key)
);
CREATE INDEX personality_events_creature_idx ON personality_events(creature_id,created_at DESC);

CREATE TABLE daily_return_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  world_id text NOT NULL DEFAULT 'bloopy-origin',
  return_date date NOT NULL,
  memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','dismissed')),
  title text NOT NULL,
  body text NOT NULL,
  choices jsonb NOT NULL,
  choice_id text,
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creature_id,world_id,return_date)
);
CREATE INDEX daily_return_active_idx ON daily_return_instances(creature_id,status,return_date DESC);
