ALTER TABLE ai_profiles
  ADD COLUMN source text NOT NULL DEFAULT 'manual',
  ADD COLUMN external_user_id text,
  ADD COLUMN connection_status text NOT NULL DEFAULT 'active',
  ADD COLUMN connection_metadata jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN connected_at timestamptz,
  ADD COLUMN last_verified_at timestamptz,
  ADD COLUMN disconnected_at timestamptz;

ALTER TABLE ai_profiles
  ADD CONSTRAINT ai_profiles_source_check CHECK (source IN ('manual','openrouter')),
  ADD CONSTRAINT ai_profiles_connection_status_check CHECK (connection_status IN ('active','invalid','disconnected'));

UPDATE ai_profiles SET connected_at=COALESCE(connected_at,created_at) WHERE enabled=true;
CREATE INDEX ai_profiles_source_status_idx ON ai_profiles(source,connection_status) WHERE enabled=true;

CREATE TABLE openrouter_oauth_states (
  state_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  verifier_cipher text NOT NULL,
  callback_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','exchanging','completed','failed')),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX openrouter_oauth_states_player_idx ON openrouter_oauth_states(player_id,created_at DESC);
CREATE INDEX openrouter_oauth_states_expiry_idx ON openrouter_oauth_states(expires_at) WHERE status='pending';
