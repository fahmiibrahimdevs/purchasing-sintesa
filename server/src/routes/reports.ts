import { Hono } from "hono";
import { AppEnv, allowRoles, sessionAuth } from "../auth";
import { pool } from "../db/database";
import { itemsForDocuments } from "./purchases";

const router = new Hono<AppEnv>();
router.use("*", sessionAuth);

router.get("/dashboard-summary", async (c) => {
  const [purchaseRows] = await pool.query(
    `SELECT COUNT(*) AS document_count, COALESCE(SUM(header_total),0) AS purchase_total
     FROM purchase_documents WHERE record_status<>'CANCELLED'
       AND purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       AND purchase_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)`
  );
  const [invoiceRows] = await pool.query(
    `SELECT lifecycle_status, COUNT(*) AS total FROM tax_invoices
     WHERE invoice_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       AND invoice_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
     GROUP BY lifecycle_status`
  );
  const [projectPurchaseRows] = await pool.query(
    `SELECT p.id AS project_id, p.name AS project_name,
       COALESCE(monthly.document_count, 0) AS document_count,
       COALESCE(monthly.item_count, 0) AS item_count,
       COALESCE(monthly.purchase_total, 0) AS purchase_total
     FROM projects p
     LEFT JOIN (
       SELECT pi.project_id, COUNT(DISTINCT d.id) AS document_count, COUNT(pi.id) AS item_count,
         SUM(COALESCE(pi.purchase_total, pi.purchase_subtotal)) AS purchase_total
       FROM purchase_items pi
       JOIN purchase_documents d ON d.id=pi.purchase_document_id
       WHERE d.record_status<>'CANCELLED' AND pi.record_status='ACTIVE'
         AND d.purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
         AND d.purchase_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
       GROUP BY pi.project_id
     ) monthly ON monthly.project_id=p.id
     WHERE p.is_active=1 OR monthly.project_id IS NOT NULL
     ORDER BY p.name`
  );
  const [unassignedPurchaseRows] = await pool.query(
    `SELECT COUNT(DISTINCT d.id) AS document_count, COUNT(pi.id) AS item_count,
       COALESCE(SUM(COALESCE(pi.purchase_total, pi.purchase_subtotal)), 0) AS purchase_total
     FROM purchase_items pi
     JOIN purchase_documents d ON d.id=pi.purchase_document_id
     WHERE pi.project_id IS NULL AND d.record_status<>'CANCELLED' AND pi.record_status='ACTIVE'
       AND d.purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       AND d.purchase_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)`
  );
  const [monthlyItemRows] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN pi.invoice_requirement='REQUIRED' THEN 1 ELSE 0 END), 0) AS invoice_required_count,
       COALESCE(SUM(CASE WHEN pi.invoice_requirement='NOT_REQUIRED' THEN 1 ELSE 0 END), 0) AS non_invoice_count,
       COALESCE(SUM(CASE WHEN pi.invoice_requirement NOT IN ('REQUIRED', 'NOT_REQUIRED') OR pi.invoice_requirement IS NULL THEN 1 ELSE 0 END), 0) AS unclassified_count
     FROM purchase_items pi
     JOIN purchase_documents d ON d.id=pi.purchase_document_id
     WHERE d.record_status<>'CANCELLED' AND pi.record_status='ACTIVE'
       AND d.purchase_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       AND d.purchase_date < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)`
  );
  const [itemRows] = await pool.query("SELECT id FROM purchase_documents WHERE record_status<>'CANCELLED'");
  const allItems = await itemsForDocuments((itemRows as any[]).map((row) => row.id));
  const invoiceRequiredItems = allItems.filter((item) => item.invoice_requirement === "REQUIRED");
  const missingInvoiceFileItems = invoiceRequiredItems.filter((item) => !Boolean(item.has_uploaded_invoice));
  const pending = allItems.filter((item) => item.invoice_requirement !== "NOT_REQUIRED"
    && ["WAITING", "PARTIAL", "UNDER_REVIEW", "NEEDS_REVIEW"].includes(item.coverage_status));
  const statusCounts = (invoiceRows as any[]).reduce((acc, row) => ({ ...acc, [row.lifecycle_status]: Number(row.total) }), {});
  return c.json({
    purchase_documents_this_month: Number((purchaseRows as any[])[0]?.document_count || 0),
    purchase_value_this_month: Number((purchaseRows as any[])[0]?.purchase_total || 0),
    project_purchases_this_month: (projectPurchaseRows as any[]).map((row) => ({
      project_id: String(row.project_id), project_name: String(row.project_name),
      document_count: Number(row.document_count || 0), item_count: Number(row.item_count || 0),
      purchase_total: Number(row.purchase_total || 0),
    })),
    unassigned_purchase_this_month: {
      document_count: Number((unassignedPurchaseRows as any[])[0]?.document_count || 0),
      item_count: Number((unassignedPurchaseRows as any[])[0]?.item_count || 0),
      purchase_total: Number((unassignedPurchaseRows as any[])[0]?.purchase_total || 0),
    },
    invoice_required_items_this_month: Number((monthlyItemRows as any[])[0]?.invoice_required_count || 0),
    non_invoice_items_this_month: Number((monthlyItemRows as any[])[0]?.non_invoice_count || 0),
    unclassified_items_this_month: Number((monthlyItemRows as any[])[0]?.unclassified_count || 0),
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
