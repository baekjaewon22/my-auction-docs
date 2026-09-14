ALTER TABLE briefing_materials ADD COLUMN source_admin_note_id TEXT;

CREATE INDEX IF NOT EXISTS idx_briefing_materials_source_note
ON briefing_materials(source_admin_note_id);
