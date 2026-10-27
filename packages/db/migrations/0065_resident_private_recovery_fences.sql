-- A deletion result belongs to the write state captured before its external operation.
ALTER TABLE resident_object_deletions
 ADD COLUMN deletion_token uuid,
 ADD COLUMN deletion_started_at timestamptz,
 ADD COLUMN deletion_write_state text,
 ADD CONSTRAINT resident_deletion_operation_complete CHECK(
  (deletion_token IS NULL AND deletion_started_at IS NULL AND deletion_write_state IS NULL) OR
  (deletion_token IS NOT NULL AND deletion_started_at IS NOT NULL AND deletion_write_state IS NOT NULL AND deletion_write_state IN('allocated','inflight','settled','unknown'))
 );
