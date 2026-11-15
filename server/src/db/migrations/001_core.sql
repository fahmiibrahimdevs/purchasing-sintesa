CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_users_role CHECK (role IN ('PURCHASING', 'TAX_STAFF', 'ADMIN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id CHAR(36) NOT NULL PRIMARY KEY,
  supplier_code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  address TEXT NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(150) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_projects_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_documents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  purchase_group_code VARCHAR(40) NOT NULL UNIQUE,
  supplier_id CHAR(36) NOT NULL,
  supplier_document_no VARCHAR(100) NULL,
  purchase_date DATE NOT NULL,
  source_document_type VARCHAR(30) NOT NULL,
  document_currency CHAR(3) NOT NULL DEFAULT 'IDR',
  header_subtotal DECIMAL(18,2) NULL,
  header_tax_amount DECIMAL(18,2) NULL,
  header_total DECIMAL(18,2) NULL,
  notes TEXT NULL,
  record_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_by CHAR(36) NOT NULL,
  posted_by CHAR(36) NULL,
  posted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_purchase_supplier_date (supplier_id, purchase_date),
  INDEX idx_purchase_document_no (supplier_document_no),
  INDEX idx_purchase_status_date (record_status, purchase_date),
  CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_purchase_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_purchase_posted_by FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_purchase_status CHECK (record_status IN ('DRAFT', 'POSTED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  purchase_document_id CHAR(36) NOT NULL,
  item_code VARCHAR(60) NOT NULL UNIQUE,
  item_sequence INT UNSIGNED NOT NULL,
  project_id CHAR(36) NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  uom VARCHAR(30) NOT NULL,
  unit_price DECIMAL(18,2) NOT NULL,
  discount_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  purchase_subtotal DECIMAL(18,2) NOT NULL,
  purchase_tax_amount DECIMAL(18,2) NULL,
  purchase_total DECIMAL(18,2) NULL,
  invoice_requirement VARCHAR(20) NOT NULL DEFAULT 'UNDETERMINED',
  invoice_requirement_reason TEXT NULL,
  invoice_tracking_basis VARCHAR(20) NULL,
  invoice_target_quantity DECIMAL(18,4) NULL,
  invoice_target_dpp DECIMAL(18,2) NULL,
  item_notes TEXT NULL,
  record_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purchase_item_sequence (purchase_document_id, item_sequence),
  INDEX idx_purchase_items_project (project_id),
  INDEX idx_purchase_items_requirement (invoice_requirement),
  INDEX idx_purchase_items_document (purchase_document_id),
  CONSTRAINT fk_purchase_item_document FOREIGN KEY (purchase_document_id) REFERENCES purchase_documents(id),
  CONSTRAINT fk_purchase_item_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT chk_purchase_item_requirement CHECK (invoice_requirement IN ('REQUIRED', 'NOT_REQUIRED', 'UNDETERMINED')),
  CONSTRAINT chk_purchase_item_basis CHECK (invoice_tracking_basis IS NULL OR invoice_tracking_basis IN ('QUANTITY', 'DPP', 'BOTH', 'MANUAL')),
  CONSTRAINT chk_purchase_item_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_invoices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  supplier_id CHAR(36) NOT NULL,
  nsfp VARCHAR(100) NOT NULL,
  invoice_date DATE NOT NULL,
  tax_period_year SMALLINT UNSIGNED NOT NULL,
  tax_period_month TINYINT UNSIGNED NOT NULL,
  dpp_amount DECIMAL(18,2) NOT NULL,
  ppn_amount DECIMAL(18,2) NOT NULL,
  other_tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  invoice_total DECIMAL(18,2) NOT NULL,
  invoice_kind VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  replaces_tax_invoice_id CHAR(36) NULL,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  verified_by CHAR(36) NULL,
  verified_at DATETIME NULL,
  created_by CHAR(36) NOT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_nsfp (supplier_id, nsfp),
  INDEX idx_tax_invoice_period (tax_period_year, tax_period_month),
  INDEX idx_tax_invoice_status_date (lifecycle_status, invoice_date),
  CONSTRAINT fk_tax_invoice_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_tax_invoice_replaces FOREIGN KEY (replaces_tax_invoice_id) REFERENCES tax_invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_tax_invoice_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tax_invoice_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_tax_invoice_month CHECK (tax_period_month BETWEEN 1 AND 12),
  CONSTRAINT chk_tax_invoice_kind CHECK (invoice_kind IN ('NORMAL', 'REPLACEMENT', 'OTHER')),
  CONSTRAINT chk_tax_invoice_status CHECK (lifecycle_status IN ('DRAFT', 'RECEIVED', 'UNDER_REVIEW', 'VERIFIED', 'CANCELLED', 'REPLACED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_invoice_lines (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tax_invoice_id CHAR(36) NOT NULL,
  line_no INT UNSIGNED NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(18,4) NULL,
  uom VARCHAR(30) NULL,
  unit_price DECIMAL(18,2) NULL,
  discount_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  dpp_amount DECIMAL(18,2) NOT NULL,
  ppn_amount DECIMAL(18,2) NOT NULL,
  other_tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(18,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_line_no (tax_invoice_id, line_no),
  CONSTRAINT fk_invoice_line_invoice FOREIGN KEY (tax_invoice_id) REFERENCES tax_invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_invoice_purchase_allocations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tax_invoice_line_id CHAR(36) NOT NULL,
  purchase_item_id CHAR(36) NOT NULL,
  allocated_quantity DECIMAL(18,4) NULL,
  allocated_dpp DECIMAL(18,2) NOT NULL,
  allocated_ppn DECIMAL(18,2) NOT NULL DEFAULT 0,
  allocated_other_tax DECIMAL(18,2) NOT NULL DEFAULT 0,
  allocated_total DECIMAL(18,2) NOT NULL,
  allocation_note TEXT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_allocations_item (purchase_item_id),
  INDEX idx_allocations_line (tax_invoice_line_id),
  CONSTRAINT fk_allocation_line FOREIGN KEY (tax_invoice_line_id) REFERENCES tax_invoice_lines(id),
  CONSTRAINT fk_allocation_item FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id),
  CONSTRAINT fk_allocation_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follow_up_activities (
  id CHAR(36) NOT NULL PRIMARY KEY,
  purchase_document_id CHAR(36) NOT NULL,
  purchase_item_id CHAR(36) NULL,
  supplier_id CHAR(36) NOT NULL,
  activity_at DATETIME NOT NULL,
  channel VARCHAR(30) NOT NULL,
  contact_person VARCHAR(150) NULL,
  result TEXT NOT NULL,
  promised_issue_date DATE NULL,
  next_follow_up_at DATETIME NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_followup_supplier_date (supplier_id, activity_at),
  INDEX idx_followup_next (next_follow_up_at),
  CONSTRAINT fk_followup_document FOREIGN KEY (purchase_document_id) REFERENCES purchase_documents(id),
  CONSTRAINT fk_followup_item FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_followup_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_followup_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attachments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  purchase_document_id CHAR(36) NULL,
  tax_invoice_id CHAR(36) NULL,
  category VARCHAR(30) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supersedes_attachment_id CHAR(36) NULL,
  CONSTRAINT fk_attachment_purchase FOREIGN KEY (purchase_document_id) REFERENCES purchase_documents(id),
  CONSTRAINT fk_attachment_invoice FOREIGN KEY (tax_invoice_id) REFERENCES tax_invoices(id),
  CONSTRAINT fk_attachment_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_attachment_supersedes FOREIGN KEY (supersedes_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
  CONSTRAINT chk_attachment_owner CHECK ((purchase_document_id IS NULL) <> (tax_invoice_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tax_invoice_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tax_invoice_id CHAR(36) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  event_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id CHAR(36) NOT NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  reason TEXT NULL,
  related_tax_invoice_id CHAR(36) NULL,
  INDEX idx_invoice_events_date (tax_invoice_id, event_at),
  CONSTRAINT fk_invoice_event_invoice FOREIGN KEY (tax_invoice_id) REFERENCES tax_invoices(id),
  CONSTRAINT fk_invoice_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_invoice_event_related FOREIGN KEY (related_tax_invoice_id) REFERENCES tax_invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id CHAR(36) NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity (entity_type, entity_id, created_at),
  INDEX idx_audit_user_time (user_id, created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
