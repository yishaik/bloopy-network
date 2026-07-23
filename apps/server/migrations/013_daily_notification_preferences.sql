CREATE TABLE notification_preferences (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'UTC',
  delivery_time time NOT NULL DEFAULT '10:00',
  quiet_start time NOT NULL DEFAULT '22:00',
  quiet_end time NOT NULL DEFAULT '08:00',
  next_delivery_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_preferences_due_idx
  ON notification_preferences(next_delivery_at)
  WHERE enabled=true AND next_delivery_at IS NOT NULL;

ALTER TABLE daily_return_instances
  ADD COLUMN notification_scheduled_at timestamptz,
  ADD COLUMN notification_sent_at timestamptz,
  ADD COLUMN notification_opened_at timestamptz;

ALTER TABLE outbox
  ADD COLUMN source_key text,
  ADD COLUMN player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN creature_id uuid REFERENCES creatures(id) ON DELETE SET NULL,
  ADD COLUMN daily_return_id uuid REFERENCES daily_return_instances(id) ON DELETE SET NULL,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN last_error text;

CREATE UNIQUE INDEX outbox_source_key_unique_idx
  ON outbox(source_key)
  WHERE source_key IS NOT NULL;
CREATE INDEX outbox_daily_return_idx
  ON outbox(daily_return_id)
  WHERE daily_return_id IS NOT NULL;
