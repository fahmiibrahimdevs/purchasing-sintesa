ALTER TABLE purchase_documents
  MODIFY source_document_type VARCHAR(30) NOT NULL DEFAULT 'OTHER';

UPDATE purchase_items
SET invoice_requirement = 'REQUIRED', invoice_requirement_reason = NULL
WHERE invoice_requirement = 'UNDETERMINED';

ALTER TABLE purchase_items
  MODIFY invoice_requirement VARCHAR(20) NOT NULL DEFAULT 'REQUIRED';
