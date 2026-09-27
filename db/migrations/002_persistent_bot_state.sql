-- Initial identity schema is immutable. This migration adds the bot's durable state.
ALTER TABLE participant_registrations
  ADD COLUMN access_revoked_at timestamptz;

CREATE TABLE invoice_intents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  ticket_class varchar(32) NOT NULL,
  ticket_size varchar(32) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'failed', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX ix_invoice_intents_user_created ON invoice_intents(user_id, created_at DESC);

CREATE TABLE payment_receipts (
  telegram_payment_charge_id text PRIMARY KEY CHECK (length(telegram_payment_charge_id) BETWEEN 1 AND 256),
  invoice_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  provider_payment_charge_id text,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invoice_id, user_id) REFERENCES invoice_intents(id, user_id)
);
CREATE INDEX ix_payment_receipts_user ON payment_receipts(user_id, paid_at DESC);
CREATE INDEX ix_payment_receipts_invoice ON payment_receipts(invoice_id);

-- Channel events may arrive before a person registers. Telegram ID is therefore
-- kept independently of users and joined when that participant signs up.
CREATE TABLE engagement_accounts (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id > 0)
);
CREATE TABLE engagement_awards (
  id uuid PRIMARY KEY,
  telegram_user_id bigint NOT NULL REFERENCES engagement_accounts(telegram_user_id),
  dedup_key text NOT NULL,
  rule varchar(32) NOT NULL,
  points integer NOT NULL CHECK (points > 0),
  subject text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX ux_engagement_awards_active_key
  ON engagement_awards(telegram_user_id, dedup_key) WHERE revoked_at IS NULL;
CREATE INDEX ix_engagement_awards_active_time
  ON engagement_awards(telegram_user_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE beta_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  beta_open smallint[] NOT NULL,
  updated_by_telegram_user_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
