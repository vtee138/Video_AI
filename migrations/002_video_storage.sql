ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'local'
    CHECK (storage_provider IN ('local', 'r2')),
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS media_url text;
