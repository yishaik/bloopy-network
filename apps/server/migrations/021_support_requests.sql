-- A support request a player sends through the manager bot.
--
-- Without this, a support message is handled as an ordinary game action and never reaches a human:
-- the channel exists on paper only. Storing the request makes it something an operator can find.
CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players(id) ON DELETE CASCADE,
  -- Kept alongside player_id so a request from someone whose account was removed can still be
  -- reconciled during the deletion window; the deletion sweep clears it explicitly.
  telegram_user_id bigint,
  chat_id bigint NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
  -- One request per Telegram update, so a webhook retry cannot open a duplicate ticket.
  source_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX support_requests_open_idx ON support_requests(status,created_at DESC);
