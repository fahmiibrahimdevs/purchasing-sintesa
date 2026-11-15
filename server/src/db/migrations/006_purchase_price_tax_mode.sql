ALTER TABLE purchase_documents
  ADD COLUMN price_tax_mode VARCHAR(12) NOT NULL DEFAULT 'EXCLUSIVE' AFTER source_document_type,
  ADD CONSTRAINT chk_purchase_price_tax_mode CHECK (price_tax_mode IN ('INCLUSIVE', 'EXCLUSIVE'));

ALTER TABLE purchase_items
  ADD COLUMN unit_price_entered DECIMAL(18,2) NULL AFTER unit_price;

UPDATE purchase_items SET unit_price_entered = unit_price WHERE unit_price_entered IS NULL;
