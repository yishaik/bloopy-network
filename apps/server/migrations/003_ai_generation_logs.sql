CREATE TABLE ai_generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  creature_id uuid REFERENCES creatures(id) ON DELETE SET NULL,
  scene_id text NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_version text NOT NULL,
  used_ai boolean NOT NULL,
  fallback_reason text,
  latency_ms integer NOT NULL DEFAULT 0,
  input_chars integer NOT NULL DEFAULT 0,
  output_chars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_generation_logs_created_idx ON ai_generation_logs(created_at DESC);
CREATE INDEX ai_generation_logs_provider_created_idx ON ai_generation_logs(provider,created_at DESC);
