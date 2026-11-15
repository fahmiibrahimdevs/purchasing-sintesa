# Purchasing & Tax Invoice MVP Scope

## In scope

- Internal web app with exactly three roles: `PURCHASING`, `TAX_STAFF`, and `ADMIN`.
- Supplier and project masters.
- Purchase document headers with multiple purchase item rows.
- Grouped and flat purchase views, draft/post lifecycle, purchase source attachments.
- Invoice requirement and tracking basis on each purchase item.
- Tax invoice headers, invoice lines, private PDF attachments, and purchase-item allocations.
- Follow-up activity history, verification, cancellation, replacement, correction events, and general audit logs.
- Purchase, tax-period, and pending-invoice reports with Excel export.
- Internal consistency warnings across purchase totals, invoice lines, and allocations.

## Out of scope

- Coretax pages, imports, API calls, reconciliation batches, and Coretax status fields.
- Any other external service integration, OCR, payment/accounting workflows, and multi-step approval chains.
- Bulk spreadsheet migration in the first release. Existing data can be reviewed and imported in a later, separately scoped step.

## PRD interpretation

The v1.2 transaction form direction is used: one purchase transaction form may contain many item rows, each saved as its own `purchase_items` record under a single document header. The older one-item-per-save wording in §7.2 is treated as superseded by the v1.2 form and tree-table requirements.

Tax-invoice coverage is derived from verified, active allocations. A `QUANTITY` tracking basis defaults to the purchase quantity when it is reliable; DPP targets remain explicit and are never inferred from purchase subtotal. Staff Tax can flag records for manual review when the basis is uncertain.

No tax rate is hard-coded. Tax values are entered from supplier documents.
