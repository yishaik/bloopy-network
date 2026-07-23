ALTER TABLE ai_generation_logs
  ADD COLUMN IF NOT EXISTS prompt_tokens integer,
  ADD COLUMN IF NOT EXISTS completion_tokens integer,
  ADD COLUMN IF NOT EXISTS estimated_cost_microusd bigint NOT NULL DEFAULT 0;

CREATE TABLE ai_daily_usage (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  provider text NOT NULL CHECK (provider IN ('platform','byok')),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id,usage_date,provider)
);

CREATE INDEX ai_generation_logs_player_created_idx
  ON ai_generation_logs(player_id,created_at DESC);
CREATE INDEX ai_generation_logs_platform_month_idx
  ON ai_generation_logs(created_at DESC)
  WHERE provider='platform' AND used_ai=true;
