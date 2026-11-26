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

CREATE TABLE IF NOT EXISTS support_conversations (
  id BIGSERIAL PRIMARY KEY,
  app_name TEXT NOT NULL DEFAULT 'ALVES PLAY',
  client_id VARCHAR(128) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_app_client_unique UNIQUE (app_name, client_id)
);
CREATE TABLE IF NOT EXISTS support_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('client', 'admin')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_conversations_updated_idx ON support_conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_conversation_idx ON support_messages (conversation_id, id);
