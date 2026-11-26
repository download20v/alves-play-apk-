CREATE TABLE IF NOT EXISTS app_clients (
  id BIGSERIAL PRIMARY KEY,
  app_name TEXT NOT NULL,
  client_id VARCHAR(128) NOT NULL,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_clients_app_client_unique UNIQUE (app_name, client_id)
);
CREATE INDEX IF NOT EXISTS app_clients_trial_ends_idx ON app_clients (trial_ends_at);
