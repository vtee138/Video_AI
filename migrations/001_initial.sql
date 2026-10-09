CREATE TABLE IF NOT EXISTS videos (
      output_name text PRIMARY KEY,
      run_id text,
      title text NOT NULL,
      caption text NOT NULL DEFAULT '',
      template text,
      manual_publication text NOT NULL DEFAULT 'not_posted'
        CHECK (manual_publication IN ('unknown', 'not_posted', 'posted')),
      rendered_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS jobs (
      run_id text PRIMARY KEY,
      parent_id text,
      title text NOT NULL,
      template text,
      mode text,
      status text NOT NULL,
      step text,
      progress real NOT NULL DEFAULT 0,
      error text,
      output_name text,
      auto_mode boolean NOT NULL DEFAULT false,
      auto_settings jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS deleted_sessions (
      id text PRIMARY KEY,
      deleted_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id text PRIMARY KEY,
      output_name text NOT NULL REFERENCES videos(output_name),
      source text NOT NULL CHECK (source IN ('auto', 'manual')),
      results jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS posts_output_created_idx ON posts(output_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS jobs_updated_idx ON jobs(updated_at DESC);
    CREATE TABLE IF NOT EXISTS super_campaigns (
      id text PRIMARY KEY,
      status text NOT NULL CHECK (status IN ('active', 'attention', 'stopped')),
      template text NOT NULL,
      mode text,
      focus text NOT NULL DEFAULT '',
      interval_minutes integer NOT NULL,
      next_at timestamptz NOT NULL,
      ready_after timestamptz NOT NULL DEFAULT now(),
      last_started_at timestamptz,
      auto_settings jsonb NOT NULL,
      error text,
      failure_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS super_items (
      id text PRIMARY KEY,
      campaign_id text NOT NULL REFERENCES super_campaigns(id),
      topic text,
      job_id text,
      scheduled_at timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('planning', 'producing', 'manual_review', 'scheduled', 'publishing', 'sent', 'failed', 'needs_review', 'canceled')),
      output_name text,
      post_id text,
      targets jsonb,
      error text,
      recovery_pending boolean NOT NULL DEFAULT false,
      retry_requested boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS super_items_due_idx ON super_items(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS super_items_campaign_idx ON super_items(campaign_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS super_campaign_one_live_idx ON super_campaigns ((true))
      WHERE status IN ('active', 'attention');
    ALTER TABLE super_campaigns ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;
    ALTER TABLE super_items ADD COLUMN IF NOT EXISTS recovery_pending boolean NOT NULL DEFAULT false;
    ALTER TABLE super_items ADD COLUMN IF NOT EXISTS retry_requested boolean NOT NULL DEFAULT false;
    ALTER TABLE super_items DROP CONSTRAINT IF EXISTS super_items_status_check;
    ALTER TABLE super_items ADD CONSTRAINT super_items_status_check
      CHECK (status IN ('planning', 'producing', 'manual_review', 'scheduled', 'publishing', 'sent', 'failed', 'needs_review', 'canceled'));
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_settings jsonb;
    CREATE TABLE IF NOT EXISTS flow_assets (
      id uuid PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('background', 'model')),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS flow_jobs (
      id uuid PRIMARY KEY,
      state text NOT NULL,
      category text NOT NULL,
      duration integer NOT NULL,
      background_id uuid NOT NULL REFERENCES flow_assets(id),
      model_id uuid REFERENCES flow_assets(id),
      has_action boolean NOT NULL DEFAULT false,
      continuous_video boolean NOT NULL DEFAULT false,
      source_seconds real,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS flow_jobs_updated_idx ON flow_jobs(updated_at DESC);
    ALTER TABLE flow_jobs ADD COLUMN IF NOT EXISTS continuous_video boolean NOT NULL DEFAULT false;
