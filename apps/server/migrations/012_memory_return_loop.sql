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
  tier=CASE
    WHEN source_type='genesis' THEN 'identity'
    WHEN source_type='world' THEN 'world'
    WHEN source_type='telegram_text' THEN 'working'
    ELSE 'episodic'
  END,
  source_version=CASE
    WHEN source_type='genesis' THEN 'character-genesis-v1'
    WHEN source_type='story_arc' THEN 'impossible-door-v1'
    WHEN source_type='telegram_text' THEN 'telegram-text-v1'
    ELSE 'legacy-v1'
  END,
  privacy_level=CASE WHEN is_private THEN 'private' ELSE 'shared' END,
  confidence=CASE WHEN source_type='telegram_text' THEN LEAST(confidence,0.4) ELSE confidence END,
  canonical_status=CASE WHEN source_type='telegram_text' THEN 'user_asserted' ELSE canonical_status END,
  expires_at=CASE WHEN source_type='telegram_text' THEN COALESCE(expires_at,created_at+interval '24 hours') ELSE expires_at END
WHERE source_version='legacy-v1';

ALTER TABLE memories
  ADD CONSTRAINT memories_tier_check CHECK (tier IN ('working','episodic','identity','world')),
  ADD CONSTRAINT memories_privacy_check CHECK (privacy_level IN ('private','shared')),
  ADD CONSTRAINT memories_confidence_check CHECK (confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT memories_canonical_check CHECK (canonical_status IN ('approved','user_asserted','superseded','rejected'));

CREATE OR REPLACE FUNCTION apply_memory_source_defaults() RETURNS trigger AS $$
BEGIN
  NEW.privacy_level := CASE WHEN NEW.is_private THEN 'private' ELSE 'shared' END;
  IF NEW.source_version='legacy-v1' THEN
    CASE NEW.source_type
      WHEN 'genesis' THEN
        NEW.tier := 'identity';
        NEW.source_version := 'character-genesis-v1';
        NEW.canonical_status := 'approved';
        NEW.confidence := 1;
      WHEN 'story_arc' THEN
        NEW.tier := 'episodic';
        NEW.source_version := 'impossible-door-v1';
        NEW.canonical_status := 'approved';
        NEW.confidence := 1;
      WHEN 'telegram_text' THEN
        NEW.tier := 'working';
        NEW.source_version := 'telegram-text-v1';
        NEW.canonical_status := 'user_asserted';
        NEW.confidence := LEAST(NEW.confidence,0.4);
        NEW.expires_at := COALESCE(NEW.expires_at,now()+interval '24 hours');
      WHEN 'world' THEN
        NEW.tier := 'world';
        NEW.source_version := 'world-v1';
        NEW.canonical_status := 'approved';
      ELSE
        NEW.tier := COALESCE(NEW.tier,'episodic');
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_source_defaults
  BEFORE INSERT ON memories
  FOR EACH ROW EXECUTE FUNCTION apply_memory_source_defaults();

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

CREATE TABLE player_daily_activity (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  first_open_at timestamptz NOT NULL DEFAULT now(),
  last_open_at timestamptz NOT NULL DEFAULT now(),
  open_count integer NOT NULL DEFAULT 1 CHECK (open_count > 0),
  PRIMARY KEY (player_id,activity_date)
);
CREATE INDEX player_daily_activity_date_idx ON player_daily_activity(activity_date,player_id);
