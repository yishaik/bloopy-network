CREATE TABLE telegram_updates (
  source text NOT NULL,
  update_id bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, update_id)
);
CREATE INDEX telegram_updates_received_idx ON telegram_updates(received_at);

ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error text;
