export type Role = "PURCHASING" | "TAX_STAFF" | "ADMIN";
export type User = { id: string; name: string; email: string; role: Role; is_active?: number; purchase_count?: number | string; related_count?: number | string };
export type Supplier = { id: string; supplier_code: string; name: string; address?: string; phone?: string; email?: string; is_active: number; purchase_count?: number | string; related_count?: number | string };
export type Project = { id: string; project_code: string; name: string; is_active: number; purchase_count?: number | string; related_count?: number | string };
export type InvoiceAttachment = { id: string; original_filename: string; mime_type: string; file_size: number; nsfp: string; invoice_date: string };
export type InvoiceLink = {
  id: string; nsfp: string; invoice_date: string; lifecycle_status: string; invoice_kind: string;
  file_replacement_pending?: boolean | number;
  replaces_nsfp?: string | null; replacement_nsfp?: string | null;
  replacement_invoice_id?: string | null; replacement_lifecycle_status?: string | null;
  allocated_quantity: string | number; allocated_dpp: string | number; allocated_ppn: string | number; allocated_total: string | number;
  latest_attachment_id?: string | null; latest_attachment_filename?: string | null; latest_attachment_mime_type?: string | null;
};
export type PurchaseItem = {
  id: string; purchase_document_id: string; item_code: string; item_sequence: number; project_id?: string | null; supplier_id?: string; supplier_document_no?: string; purchase_group_code?: string; purchase_date?: string; supplier_name?: string;
  project_name?: string; item_name: string; item_description?: string; item_notes?: string; quantity: string | number; uom: string;
  unit_price: string | number; purchase_subtotal: string | number;
  purchase_tax_amount?: string | number | null; purchase_total?: string | number | null;
  invoice_requirement: "REQUIRED" | "NOT_REQUIRED";
  active_quantity?: string | number; active_dpp?: string | number; remaining_quantity?: number | null; remaining_dpp?: number | null;
  reserved_quantity?: string | number; available_quantity?: string | number;
  coverage_status?: string; has_uploaded_invoice?: boolean | number; invoice_attachments?: InvoiceAttachment[]; invoice_links?: InvoiceLink[];
};
export type PurchaseDocument = {
  id: string; purchase_group_code: string; supplier_id: string; supplier_name: string; supplier_code: string;
  supplier_document_no?: string; purchase_date: string; source_document_type: string; header_subtotal?: string | number;
  header_tax_amount?: string | number; header_total?: string | number; notes?: string; record_status: string;
  item_count: number; total_amount: string | number; items: PurchaseItem[];
};
export type InvoiceAllocation = { id?: string; purchase_item_id: string; item_code?: string; item_name?: string; allocated_quantity?: string | number; allocated_dpp: string | number; allocated_ppn: string | number; allocated_other_tax?: string | number; allocated_total: string | number; allocation_note?: string };
export type InvoiceLine = { id: string; line_no: number; description: string; quantity?: string | number; uom?: string; dpp_amount: string | number; ppn_amount: string | number; other_tax_amount: string | number; line_total: string | number; allocations?: InvoiceAllocation[] };
export type TaxInvoice = {
  id: string; supplier_id: string; supplier_name: string; nsfp: string; invoice_date: string; tax_period_year: number;
  tax_period_month: number; dpp_amount: string | number; ppn_amount: string | number; other_tax_amount: string | number;
  invoice_total: string | number; invoice_kind: string; replaces_tax_invoice_id?: string | null; lifecycle_status: string; file_replacement_pending?: boolean; replacement_invoice_id?: string | null; replacement_nsfp?: string | null; replacement_lifecycle_status?: string | null;
  lines?: InvoiceLine[]; events?: Array<{ id: string; event_type: string; event_at: string; actor_name: string; reason?: string }>;
  attachments?: Array<{ id: string; tax_invoice_id?: string; category: string; original_filename: string; mime_type: string; file_size: number; uploaded_at?: string; uploaded_by?: string; uploaded_by_name?: string; supersedes_attachment_id?: string | null; revision_reason?: string | null; version_nsfp?: string; version_invoice_date?: string; version_status?: string; version_number?: number | null; cancellation_reason?: string | null; cancelled_at?: string | null; cancelled_by_name?: string | null }>;
};
export type PageResult<T> = { data: T[]; page: number; pageSize: number; total: number; totalPages: number };
