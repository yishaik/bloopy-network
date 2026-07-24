ALTER TABLE managed_bots
  ADD COLUMN access_policy text NOT NULL DEFAULT 'owner_only',
  ADD COLUMN allow_bot_interactions boolean NOT NULL DEFAULT false,
  ADD COLUMN token_version integer NOT NULL DEFAULT 1,
  ADD COLUMN last_webhook_at timestamptz,
  ADD COLUMN last_outbound_at timestamptz,
  ADD COLUMN last_token_rotated_at timestamptz,
  ADD COLUMN revoked_at timestamptz;

ALTER TABLE managed_bots
  ADD CONSTRAINT managed_bots_access_policy_check CHECK (access_policy IN ('owner_only','allowlist'));

CREATE TABLE managed_bot_access_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id bigint NOT NULL REFERENCES managed_bots(bot_id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  telegram_user_id bigint,
  chat_type text NOT NULL CHECK (chat_type IN ('private','group','supergroup')),
  enabled boolean NOT NULL DEFAULT true,
  created_by_owner_telegram_user_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bot_id,chat_id,telegram_user_id)
);
CREATE INDEX managed_bot_access_rules_lookup_idx
  ON managed_bot_access_rules(bot_id,chat_id,telegram_user_id)
  WHERE enabled=true;

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  bot_id bigint,
  telegram_user_id bigint,
  chat_id bigint,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_recent_idx ON security_events(created_at DESC,event_type);

CREATE TABLE bot_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_bot_id bigint NOT NULL REFERENCES managed_bots(bot_id) ON DELETE CASCADE,
  target_bot_id bigint NOT NULL REFERENCES managed_bots(bot_id) ON DELETE CASCADE,
  source_owner_telegram_user_id bigint NOT NULL,
  target_owner_telegram_user_id bigint NOT NULL,
  source_username text NOT NULL,
  target_username text NOT NULL,
  world_id text NOT NULL DEFAULT 'bloopy-origin',
  scene_id text NOT NULL DEFAULT 'managed-bot-meeting',
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','completed','expired','rejected','cancelled')),
  max_turns integer NOT NULL DEFAULT 4 CHECK (max_turns BETWEEN 2 AND 8),
  turn_count integer NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  expires_at timestamptz NOT NULL,
  termination_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (source_bot_id <> target_bot_id)
);
CREATE INDEX bot_interactions_active_idx ON bot_interactions(state,expires_at);
CREATE INDEX bot_interactions_pair_budget_idx ON bot_interactions(source_bot_id,target_bot_id,created_at DESC);
CREATE INDEX bot_interactions_owner_budget_idx ON bot_interactions(source_owner_telegram_user_id,created_at DESC);

CREATE TABLE bot_interaction_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL REFERENCES bot_interactions(id) ON DELETE CASCADE,
  turn_index integer NOT NULL CHECK (turn_index >= 0),
  sender_bot_id bigint NOT NULL,
  receiver_bot_id bigint NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  message_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(interaction_id,turn_index)
);
CREATE INDEX bot_interaction_turns_interaction_idx ON bot_interaction_turns(interaction_id,turn_index);

ALTER TABLE game_events ADD COLUMN command_key text;
CREATE UNIQUE INDEX game_events_command_key_unique_idx
  ON game_events(command_key)
  WHERE command_key IS NOT NULL;

ALTER TABLE memories ADD COLUMN command_key text;
CREATE UNIQUE INDEX memories_command_key_unique_idx
  ON memories(command_key)
  WHERE command_key IS NOT NULL;
