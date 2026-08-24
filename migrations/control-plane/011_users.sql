ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS password_hash text;

ALTER TABLE users
  ALTER COLUMN oidc_issuer DROP NOT NULL,
  ALTER COLUMN oidc_subject DROP NOT NULL,
  ALTER COLUMN display_name DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx
  ON users (username)
  WHERE username IS NOT NULL;
