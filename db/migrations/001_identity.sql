CREATE TABLE users (
  id uuid PRIMARY KEY,
  telegram_user_id bigint NOT NULL UNIQUE CHECK (telegram_user_id > 0),
  username varchar(64),
  first_name varchar(128),
  last_name varchar(128),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE participant_registrations (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referral_code varchar(6) NOT NULL UNIQUE CHECK (referral_code ~ '^[A-Z0-9]{6}$'),
  referred_by_user_id uuid REFERENCES users(id),
  first_source varchar(16) NOT NULL CHECK (first_source IN ('mini_app', 'bot')),
  mini_app_registered_at timestamptz,
  bot_registered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referred_by_user_id IS NULL OR referred_by_user_id <> user_id),
  CHECK (mini_app_registered_at IS NOT NULL OR bot_registered_at IS NOT NULL)
);

CREATE INDEX ix_participant_registrations_referrer
  ON participant_registrations(referred_by_user_id, created_at DESC);

CREATE TABLE api_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX ix_api_sessions_user_expiry ON api_sessions(user_id, expires_at DESC);
CREATE INDEX ix_api_sessions_active_expiry ON api_sessions(expires_at) WHERE revoked_at IS NULL;
