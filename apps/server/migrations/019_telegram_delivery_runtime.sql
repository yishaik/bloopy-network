ALTER TABLE telegram_updates
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN status text NOT NULL DEFAULT 'received',
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_error text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN completed_at timestamptz;

ALTER TABLE telegram_updates
  ADD CONSTRAINT telegram_updates_status_check CHECK (status IN ('received','processing','retryable','completed','failed'));
CREATE INDEX telegram_updates_claim_idx
  ON telegram_updates(status,available_at,received_at)
  WHERE status IN ('received','retryable','processing');
CREATE INDEX telegram_updates_lease_idx
  ON telegram_updates(lease_expires_at)
  WHERE status='processing';

ALTER TABLE outbox
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN telegram_message_id bigint,
  ADD COLUMN error_class text,
  ADD COLUMN delivery_latency_ms integer;

CREATE INDEX outbox_claim_idx
  ON outbox(status,available_at,created_at)
  WHERE status IN ('pending','retryable','sending');
CREATE INDEX outbox_lease_idx
  ON outbox(lease_expires_at)
  WHERE status='sending';
CREATE INDEX outbox_operator_idx
  ON outbox(status,created_at DESC)
  WHERE status IN ('retryable','uncertain','dead_letter','failed');

CREATE TABLE runtime_controls (
  control_key text PRIMARY KEY,
  enabled boolean NOT NULL,
  reason text,
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO runtime_controls (control_key,enabled,reason) VALUES
  ('telegram_ingress',true,NULL),
  ('outbox_delivery',true,NULL),
  ('risky_mutations',true,NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  source_key text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_events_recent_idx ON operational_events(created_at DESC,event_type);
