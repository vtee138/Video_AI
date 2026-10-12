ALTER TABLE super_campaigns ADD COLUMN IF NOT EXISTS video_limit integer;
ALTER TABLE super_campaigns DROP CONSTRAINT IF EXISTS super_campaigns_status_check;
ALTER TABLE super_campaigns ADD CONSTRAINT super_campaigns_status_check
  CHECK (status IN ('active', 'attention', 'stopped', 'completed'));

ALTER TABLE super_items ADD COLUMN IF NOT EXISTS slot_index integer;
ALTER TABLE super_items DROP CONSTRAINT IF EXISTS super_items_status_check;
ALTER TABLE super_items ADD CONSTRAINT super_items_status_check
  CHECK (status IN ('waiting', 'planning', 'producing', 'manual_review', 'scheduled',
    'publishing', 'sent', 'failed', 'needs_review', 'canceled'));
CREATE UNIQUE INDEX IF NOT EXISTS super_items_slot_idx ON super_items(campaign_id, slot_index)
  WHERE slot_index IS NOT NULL;
