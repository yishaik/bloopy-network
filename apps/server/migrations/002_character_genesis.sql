CREATE TABLE onboarding_states (
  creature_id uuid PRIMARY KEY REFERENCES creatures(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('wake_choice','identity','complete')),
  wake_choice text CHECK (wake_choice IN ('gentle','noise','snack')),
  visual_marker text CHECK (visual_marker IN ('moon','star','dot')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE story_flags (
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  flag_value jsonb NOT NULL DEFAULT 'true'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creature_id, flag_key)
);

CREATE TABLE player_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creature_id uuid NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
  scene_id text NOT NULL,
  choice_id text NOT NULL,
  choice_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creature_id, scene_id)
);

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  creature_id uuid REFERENCES creatures(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_created_idx ON analytics_events(event_name, created_at DESC);

-- Existing production creatures keep their current playable experience.
INSERT INTO onboarding_states (creature_id, status, completed_at)
SELECT id, 'complete', now()
FROM creatures
ON CONFLICT (creature_id) DO NOTHING;
