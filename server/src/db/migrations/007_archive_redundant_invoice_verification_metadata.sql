-- Keep the old verification metadata in the audit log before dropping the duplicate columns.
-- Invoice verification actions already have an actor and timestamp in tax_invoice_events.
SET @has_verified_by = EXISTS(
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tax_invoices' AND column_name = 'verified_by'
);
SET @has_verified_at = EXISTS(
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tax_invoices' AND column_name = 'verified_at'
);
SET @verified_by_expr = IF(@has_verified_by, 'ti.verified_by', 'NULL');
SET @verified_at_expr = IF(@has_verified_at, 'ti.verified_at', 'NULL');

SET @archive_metadata_sql = IF(
  @has_verified_by OR @has_verified_at,
  CONCAT(
    'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, new_values, reason, created_at) ',
    'SELECT UUID(), COALESCE(', @verified_by_expr, ', ti.created_by), ',
    '''ARCHIVE_VERIFICATION_METADATA'', ''TAX_INVOICE'', ti.id, ',
    'JSON_OBJECT(''verified_by'', ', @verified_by_expr, ', ''verified_at'', ', @verified_at_expr,
      ', ''source'', ''007_archive_redundant_invoice_verification_metadata''), ',
    '''Metadata verifikasi lama disimpan sebelum kolom dibersihkan.'', ',
    'COALESCE(', @verified_at_expr, ', ti.updated_at, ti.created_at) ',
    'FROM tax_invoices ti WHERE (', @verified_by_expr, ' IS NOT NULL OR ', @verified_at_expr, ' IS NOT NULL) ',
    'AND NOT EXISTS (SELECT 1 FROM audit_logs al WHERE al.action = ''ARCHIVE_VERIFICATION_METADATA'' ',
      'AND al.entity_type = ''TAX_INVOICE'' AND al.entity_id = ti.id)'
  ),
  'SELECT 1'
);
PREPARE archive_metadata_stmt FROM @archive_metadata_sql;
EXECUTE archive_metadata_stmt;
DEALLOCATE PREPARE archive_metadata_stmt;

SET @drop_verified_by_fk_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'tax_invoices'
      AND constraint_name = 'fk_tax_invoice_verified_by' AND constraint_type = 'FOREIGN KEY'
  ),
  'ALTER TABLE tax_invoices DROP FOREIGN KEY fk_tax_invoice_verified_by',
  'SELECT 1'
);
PREPARE drop_verified_by_fk_stmt FROM @drop_verified_by_fk_sql;
EXECUTE drop_verified_by_fk_stmt;
DEALLOCATE PREPARE drop_verified_by_fk_stmt;

SELECT GROUP_CONCAT(CONCAT('DROP COLUMN `', column_name, '`') ORDER BY column_name SEPARATOR ', ')
INTO @drop_verification_columns
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'tax_invoices'
  AND column_name IN ('verified_by', 'verified_at');
SET @drop_verification_columns_sql = IF(
  @drop_verification_columns IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE tax_invoices ', @drop_verification_columns)
);
PREPARE drop_verification_columns_stmt FROM @drop_verification_columns_sql;
EXECUTE drop_verification_columns_stmt;
DEALLOCATE PREPARE drop_verification_columns_stmt;
