ALTER TABLE suppliers
  ADD COLUMN default_invoice_requirement VARCHAR(20) NOT NULL DEFAULT 'REQUIRED' AFTER email,
  ADD CONSTRAINT chk_supplier_invoice_requirement_default CHECK (default_invoice_requirement IN ('REQUIRED', 'NOT_REQUIRED'));
