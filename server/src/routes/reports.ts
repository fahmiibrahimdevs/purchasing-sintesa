import { Hono } from "hono";
import { AppEnv, allowRoles, sessionAuth } from "../auth";
import { pool } from "../db/database";
import { itemsForDocuments } from "./purchases";

const router = new Hono<AppEnv>();
router.use("*", sessionAuth);

router.get("/dashboard-summary", async (c) => {
  const [purchaseRows] = await pool.query(
    `SELECT COUNT(*) AS document_count, COALESCE(SUM(header_total),0) AS purchase_total
     FROM purchase_documents WHERE record_status<>'CANCELLED' AND purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
  );
  const [invoiceRows] = await pool.query(
    `SELECT lifecycle_status, COUNT(*) AS total FROM tax_invoices
     WHERE invoice_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') GROUP BY lifecycle_status`
  );
  const [itemRows] = await pool.query("SELECT id FROM purchase_documents WHERE record_status<>'CANCELLED'");
  const allItems = await itemsForDocuments((itemRows as any[]).map((row) => row.id));
  const invoiceRequiredItems = allItems.filter((item) => item.invoice_requirement !== "NOT_REQUIRED");
  const missingInvoiceFileItems = invoiceRequiredItems.filter((item) => !Boolean(item.has_uploaded_invoice));
  const pending = invoiceRequiredItems.filter((item) => ["WAITING", "PARTIAL", "UNDER_REVIEW", "NEEDS_REVIEW"].includes(item.coverage_status));
  const statusCounts = (invoiceRows as any[]).reduce((acc, row) => ({ ...acc, [row.lifecycle_status]: Number(row.total) }), {});
  return c.json({
    purchase_documents_this_month: Number((purchaseRows as any[])[0]?.document_count || 0),
    purchase_value_this_month: Number((purchaseRows as any[])[0]?.purchase_total || 0),
    invoice_status_counts: statusCounts,
    total_items: allItems.length,
    items_requiring_invoice: invoiceRequiredItems.length,
    missing_invoice_file_items: missingInvoiceFileItems.length,
    pending_items: pending.length,
    partial_items: pending.filter((item) => item.coverage_status === "PARTIAL").length,
    needs_review_items: pending.filter((item) => item.coverage_status === "NEEDS_REVIEW").length,
  });
});

router.get("/reports/purchases", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query("pageSize") || 50)));
  const from = c.req.query("from"); const to = c.req.query("to");
  const supplierId = c.req.query("supplierId"); const projectId = c.req.query("projectId");
  const clauses = ["d.record_status<>'CANCELLED'"]; const params: any[] = [];
  if (from) { clauses.push("d.purchase_date>=?"); params.push(from); }
  if (to) { clauses.push("d.purchase_date<=?"); params.push(to); }
  if (supplierId) { clauses.push("d.supplier_id=?"); params.push(supplierId); }
  if (projectId) { clauses.push("EXISTS (SELECT 1 FROM purchase_items fpi WHERE fpi.purchase_document_id=d.id AND fpi.project_id=?)"); params.push(projectId); }
  const [docRows] = await pool.execute(`SELECT DISTINCT d.id FROM purchase_documents d WHERE ${clauses.join(" AND ")} ORDER BY d.id DESC`, params);
  const allItems = await itemsForDocuments((docRows as any[]).map((row) => row.id));
  const filtered = allItems.filter((item) => !projectId || item.project_id === projectId);
  const start = (page - 1) * pageSize;
  return c.json({ data: filtered.slice(start, start + pageSize), page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) });
});

router.get("/reports/pending", allowRoles("TAX_STAFF", "ADMIN"), async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query("pageSize") || 50)));
  const from = c.req.query("from"); const to = c.req.query("to");
  const supplierId = c.req.query("supplierId"); const projectId = c.req.query("projectId");
  const [docRows] = await pool.execute(
    `SELECT d.id FROM purchase_documents d WHERE d.record_status<>'CANCELLED' ${from ? "AND d.purchase_date>=?" : ""} ${to ? "AND d.purchase_date<=?" : ""} ${supplierId ? "AND d.supplier_id=?" : ""}`,
    [from, to, supplierId].filter((value) => value !== undefined)
  );
  const allItems = await itemsForDocuments((docRows as any[]).map((row) => row.id));
  const filtered = allItems.filter((item) => item.invoice_requirement !== "NOT_REQUIRED"
    && ["WAITING", "PARTIAL", "UNDER_REVIEW", "NEEDS_REVIEW"].includes(item.coverage_status)
    && (!projectId || item.project_id === projectId));
  const start = (page - 1) * pageSize;
  return c.json({ data: filtered.slice(start, start + pageSize), page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) });
});

router.get("/reports/tax-invoices", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query("pageSize") || 50)));
  const year = c.req.query("year"); const month = c.req.query("month");
  const supplierId = c.req.query("supplierId"); const status = c.req.query("status");
  const clauses = ["1=1"]; const params: any[] = [];
  if (year) { clauses.push("ti.tax_period_year=?"); params.push(year); }
  if (month) { clauses.push("ti.tax_period_month=?"); params.push(month); }
  if (supplierId) { clauses.push("ti.supplier_id=?"); params.push(supplierId); }
  if (status) { clauses.push("ti.lifecycle_status=?"); params.push(status); }
  const where = clauses.join(" AND ");
  const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM tax_invoices ti WHERE ${where}`, params);
  const total = Number((counts as any[])[0]?.total || 0);
  const [rows] = await pool.execute(
    `SELECT ti.*, s.name AS supplier_name,
       (SELECT COUNT(DISTINCT a.purchase_item_id) FROM tax_invoice_lines l JOIN tax_invoice_purchase_allocations a ON a.tax_invoice_line_id=l.id WHERE l.tax_invoice_id=ti.id) AS linked_item_count
     FROM tax_invoices ti JOIN suppliers s ON s.id=ti.supplier_id WHERE ${where}
     ORDER BY ti.tax_period_year DESC, ti.tax_period_month DESC, ti.invoice_date DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return c.json({ data: rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.get("/audit", allowRoles("ADMIN"), async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize") || 50)));
  const [rows] = await pool.execute(
    `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]
  );
  const [counts] = await pool.query("SELECT COUNT(*) AS total FROM audit_logs");
  const total = Number((counts as any[])[0]?.total || 0);
  return c.json({ data: rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

export default router;
