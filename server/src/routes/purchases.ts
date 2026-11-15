import { Hono } from "hono";
import { AppEnv, allowRoles, sessionAuth } from "../auth";
import { coverageStatus } from "../coverage";
import { newId, pool, withTransaction } from "../db/database";
import { activeCancelledAttachmentKeys } from "../utils/invoiceFileVersions";
import { writeAudit } from "../utils/audit";

const router = new Hono<AppEnv>();
router.use("*", sessionAuth);

const sourceTypes = new Set(["RECEIPT", "INVOICE", "PROFORMA_INVOICE", "OTHER"]);
const requirements = new Set(["REQUIRED", "NOT_REQUIRED"]);
const priceTaxModes = new Set(["INCLUSIVE", "EXCLUSIVE"]);
const purchasePpnRate = 0.11;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const decimalValue = (value: unknown, label: string, { nullable = false, positive = false } = {}) => {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (positive && n <= 0)) throw new Error(`${label} tidak valid.`);
  return String(value);
};

export async function itemsForDocuments(documentIds: string[], includeInvoiceAttachments = false, includeInvoiceLinks = includeInvoiceAttachments, includeLatestInvoiceAttachment = false) {
  if (!documentIds.length) return [];
  const placeholders = documentIds.map(() => "?").join(",");
  const [rows] = await pool.execute(
    `SELECT pi.*, pr.name AS project_name, d.purchase_group_code, d.supplier_document_no, d.purchase_date, d.supplier_id, s.name AS supplier_name,
       (SELECT COALESCE(SUM(COALESCE(a.allocated_quantity, pi.quantity)),0) FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status='VERIFIED') AS active_quantity,
       (SELECT COALESCE(SUM(a.allocated_dpp),0) FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status='VERIFIED') AS active_dpp,
       (SELECT COALESCE(SUM(COALESCE(a.allocated_quantity, pi.quantity)),0) FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status IN ('DRAFT','RECEIVED','UNDER_REVIEW')) AS reserved_quantity,
       (SELECT COALESCE(SUM(a.allocated_dpp),0) FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status IN ('DRAFT','RECEIVED','UNDER_REVIEW')) AS reserved_dpp,
       (SELECT COUNT(DISTINCT ti.id) FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status IN ('RECEIVED','UNDER_REVIEW')) AS pending_count,
       EXISTS (
         SELECT 1
         FROM tax_invoice_purchase_allocations a
         JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id
         JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id
         JOIN attachments att ON att.tax_invoice_id=ti.id AND att.category='TAX_INVOICE_PDF'
         WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status NOT IN ('CANCELLED','REPLACED')
       ) AS has_uploaded_invoice
     FROM purchase_items pi
     JOIN purchase_documents d ON d.id=pi.purchase_document_id
     JOIN suppliers s ON s.id=d.supplier_id
     LEFT JOIN projects pr ON pr.id=pi.project_id
     WHERE pi.purchase_document_id IN (${placeholders})
     ORDER BY pi.purchase_document_id, pi.item_sequence`,
    documentIds
  );
  const purchaseItems = rows as any[];
  const attachmentsByItem = new Map<string, any[]>();
  const invoicesByItem = new Map<string, any[]>();
  if ((includeInvoiceAttachments || includeInvoiceLinks) && purchaseItems.length) {
    const itemIds = purchaseItems.map((item) => item.id);
    const itemPlaceholders = itemIds.map(() => "?").join(",");
    if (includeInvoiceAttachments) {
      const [attachmentRows] = await pool.execute(
        `SELECT DISTINCT a.purchase_item_id, att.id, att.original_filename, att.mime_type, att.file_size, att.uploaded_at, ti.nsfp, ti.invoice_date
         FROM tax_invoice_purchase_allocations a
         JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id
         JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id
         JOIN attachments att ON att.tax_invoice_id=ti.id AND att.category='TAX_INVOICE_PDF'
           AND att.id=(SELECT latest.id FROM attachments latest
                       WHERE latest.tax_invoice_id=ti.id AND latest.category='TAX_INVOICE_PDF'
                       ORDER BY latest.uploaded_at DESC, latest.id DESC LIMIT 1)
         WHERE a.purchase_item_id IN (${itemPlaceholders}) AND ti.lifecycle_status NOT IN ('CANCELLED','REPLACED')
         ORDER BY ti.invoice_date DESC, att.uploaded_at DESC`,
        itemIds
      );
      for (const attachment of attachmentRows as any[]) {
        const list = attachmentsByItem.get(attachment.purchase_item_id) || [];
        list.push(attachment);
        attachmentsByItem.set(attachment.purchase_item_id, list);
      }
    }

    if (includeInvoiceLinks) {
      const latestAttachmentSelect = includeLatestInvoiceAttachment
        ? `(SELECT att.id FROM attachments att WHERE att.tax_invoice_id=ti.id AND att.category='TAX_INVOICE_PDF' ORDER BY att.uploaded_at DESC, att.id DESC LIMIT 1) AS latest_attachment_id,
           (SELECT att.original_filename FROM attachments att WHERE att.tax_invoice_id=ti.id AND att.category='TAX_INVOICE_PDF' ORDER BY att.uploaded_at DESC, att.id DESC LIMIT 1) AS latest_attachment_filename,
           (SELECT att.mime_type FROM attachments att WHERE att.tax_invoice_id=ti.id AND att.category='TAX_INVOICE_PDF' ORDER BY att.uploaded_at DESC, att.id DESC LIMIT 1) AS latest_attachment_mime_type,`
        : "NULL AS latest_attachment_id, NULL AS latest_attachment_filename, NULL AS latest_attachment_mime_type,";
      const [invoiceRows] = await pool.execute(
        `SELECT a.purchase_item_id, ti.id, ti.nsfp, ti.invoice_date, ti.lifecycle_status, ti.invoice_kind, ti.created_at,
           (SELECT att.id FROM attachments att WHERE att.tax_invoice_id=ti.id AND att.category='TAX_INVOICE_PDF' ORDER BY att.uploaded_at DESC, att.id DESC LIMIT 1) AS _latest_attachment_id,
           ${latestAttachmentSelect}
           SUM(COALESCE(a.allocated_quantity, pi.quantity)) AS allocated_quantity,
           SUM(a.allocated_dpp) AS allocated_dpp, SUM(a.allocated_ppn) AS allocated_ppn,
           SUM(a.allocated_total) AS allocated_total
         FROM tax_invoice_purchase_allocations a
         JOIN tax_invoice_lines tl ON tl.id=a.tax_invoice_line_id
         JOIN tax_invoices ti ON ti.id=tl.tax_invoice_id
         JOIN purchase_items pi ON pi.id=a.purchase_item_id
         WHERE a.purchase_item_id IN (${itemPlaceholders})
         GROUP BY a.purchase_item_id, ti.id, ti.nsfp, ti.invoice_date, ti.lifecycle_status, ti.invoice_kind, ti.created_at
         ORDER BY ti.invoice_date DESC, ti.created_at DESC`,
        itemIds
      );
      const linkedInvoices = invoiceRows as any[];
      const linkedInvoiceIds = [...new Set(linkedInvoices.map((invoice) => String(invoice.id)))];
      const cancelledAttachmentKeys = new Set<string>();
      const replacementLinks = new Map<string, { replaces_nsfp: string | null; replacement_nsfp: string | null }>();
      if (linkedInvoiceIds.length) {
        const invoicePlaceholders = linkedInvoiceIds.map(() => "?").join(",");
        const [relationshipRows] = await pool.execute(
          `SELECT ti.id, parent.nsfp AS replaces_nsfp,
             (SELECT replacement.nsfp FROM tax_invoices replacement
              WHERE replacement.replaces_tax_invoice_id=ti.id AND replacement.lifecycle_status<>'CANCELLED'
              ORDER BY replacement.created_at DESC LIMIT 1) AS replacement_nsfp
           FROM tax_invoices ti LEFT JOIN tax_invoices parent ON parent.id=ti.replaces_tax_invoice_id
           WHERE ti.id IN (${invoicePlaceholders})`,
          linkedInvoiceIds
        );
        for (const relation of relationshipRows as any[]) {
          replacementLinks.set(String(relation.id), {
            replaces_nsfp: relation.replaces_nsfp ? String(relation.replaces_nsfp) : null,
            replacement_nsfp: relation.replacement_nsfp ? String(relation.replacement_nsfp) : null,
          });
        }
        const [cancelEvents] = await pool.execute(
          `SELECT id, tax_invoice_id, event_type, new_values FROM tax_invoice_events WHERE event_type IN ('FILE_VERSION_CANCELLED','FILE_VERSION_RESTORED') AND tax_invoice_id IN (${invoicePlaceholders})`,
          linkedInvoiceIds
        );
        for (const key of activeCancelledAttachmentKeys(cancelEvents as any[])) cancelledAttachmentKeys.add(key);
      }
      for (const invoice of linkedInvoices) {
        const { _latest_attachment_id, ...invoiceLink } = invoice;
        Object.assign(invoiceLink, replacementLinks.get(String(invoice.id)) || {});
        invoiceLink.file_replacement_pending = !["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status)
          && Boolean(_latest_attachment_id && cancelledAttachmentKeys.has(`${invoice.id}:${_latest_attachment_id}`));
        const list = invoicesByItem.get(invoice.purchase_item_id) || [];
        list.push(invoiceLink);
        invoicesByItem.set(invoice.purchase_item_id, list);
      }
    }
  }
  return purchaseItems.map((item) => ({
    ...item,
    invoice_attachments: includeInvoiceAttachments ? attachmentsByItem.get(item.id) || [] : undefined,
    invoice_links: includeInvoiceLinks ? invoicesByItem.get(item.id) || [] : undefined,
    coverage_status: coverageStatus(item, Number(item.active_quantity), Number(item.active_dpp), Number(item.pending_count)),
    remaining_quantity: Math.max(0, Number(item.quantity) - Number(item.active_quantity)),
    available_quantity: Math.max(0, Number(item.quantity) - Number(item.active_quantity) - Number(item.reserved_quantity)),
    remaining_dpp: Number(item.quantity) > 0
      ? Math.max(0, Number(item.purchase_subtotal) * (Number(item.quantity) - Number(item.active_quantity)) / Number(item.quantity))
      : Math.max(0, Number(item.purchase_subtotal) - Number(item.active_dpp)),
  }));
}

function normalizeItem(item: any, index: number, priceTaxMode: string) {
  if (!String(item.item_name || "").trim()) throw new Error(`Nama barang baris ${index + 1} wajib diisi.`);
  if (!String(item.uom || "").trim()) throw new Error(`Satuan baris ${index + 1} wajib diisi.`);
  const requirement = String(item.invoice_requirement || "REQUIRED").toUpperCase();
  if (!requirements.has(requirement)) throw new Error(`Kebutuhan faktur baris ${index + 1} tidak valid.`);
  const rawQuantity = decimalValue(item.quantity, `Kuantitas baris ${index + 1}`, { positive: true });
  const qty = Number(rawQuantity).toFixed(4);
  if (Number(qty) <= 0) throw new Error(`Kuantitas baris ${index + 1} tidak valid.`);
  const rawPrice = decimalValue(item.unit_price, `Harga satuan baris ${index + 1}`);
  const enteredPrice = roundMoney(Number(rawPrice));
  const isTaxable = requirement === "REQUIRED";
  const netUnitPrice = isTaxable && priceTaxMode === "INCLUSIVE" ? enteredPrice / (1 + purchasePpnRate) : enteredPrice;
  const subtotalAmount = roundMoney(Number(qty) * netUnitPrice);
  const totalAmount = !isTaxable || priceTaxMode === "INCLUSIVE"
    ? roundMoney(Number(qty) * enteredPrice)
    : roundMoney(subtotalAmount * (1 + purchasePpnRate));
  const price = netUnitPrice.toFixed(2);
  const subtotal = subtotalAmount.toFixed(2);
  const tax = (isTaxable ? roundMoney(totalAmount - subtotalAmount) : 0).toFixed(2);
  const total = totalAmount.toFixed(2);
  return {
    id: newId(), item_code: "", item_sequence: index + 1,
    project_id: item.project_id || null, item_name: String(item.item_name).trim(),
    item_description: item.item_description || null, quantity: qty, uom: String(item.uom).trim(),
    unit_price: price, unit_price_entered: enteredPrice.toFixed(2), purchase_subtotal: subtotal,
    purchase_tax_amount: tax, purchase_total: total,
    invoice_requirement: requirement,
    item_notes: item.item_notes || null,
  };
}

function documentTotals(items: any[]) {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + Number(item.purchase_subtotal), 0));
  const tax = roundMoney(items.reduce((sum, item) => sum + Number(item.purchase_tax_amount || 0), 0));
  return { subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: roundMoney(subtotal + tax).toFixed(2) };
}

async function insertItems(conn: any, documentId: string, groupCode: string, items: any[]) {
  for (const item of items) {
    item.item_code = `${groupCode}-${String(item.item_sequence).padStart(2, "0")}`;
    await conn.execute(
      `INSERT INTO purchase_items
       (id, purchase_document_id, item_code, item_sequence, project_id, item_name, item_description, quantity, uom,
        unit_price, unit_price_entered, purchase_subtotal, purchase_tax_amount, purchase_total, invoice_requirement, item_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, documentId, item.item_code, item.item_sequence, item.project_id, item.item_name, item.item_description,
        item.quantity, item.uom, item.unit_price, item.unit_price_entered, item.purchase_subtotal, item.purchase_tax_amount,
        item.purchase_total, item.invoice_requirement, item.item_notes]
    );
  }
}

router.get("/purchase-documents", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 25)));
  const offset = (page - 1) * pageSize;
  const supplierId = c.req.query("supplierId");
  const projectId = c.req.query("projectId");
  const requestedInvoiceRequirement = c.req.query("invoiceRequirement");
  const invoiceRequirement = requirements.has(requestedInvoiceRequirement || "") ? requestedInvoiceRequirement : "";
  const from = c.req.query("from");
  const to = c.req.query("to");
  const q = c.req.query("q");
  const clauses: string[] = ["d.record_status <> 'CANCELLED'"];
  const params: any[] = [];
  const itemFilterClauses: string[] = [];
  const itemFilterParams: string[] = [];
  if (supplierId) { clauses.push("d.supplier_id=?"); params.push(supplierId); }
  if (from) { clauses.push("d.purchase_date>=?"); params.push(from); }
  if (to) { clauses.push("d.purchase_date<=?"); params.push(to); }
  if (projectId === "none") itemFilterClauses.push("%alias%.project_id IS NULL");
  else if (projectId) { itemFilterClauses.push("%alias%.project_id=?"); itemFilterParams.push(projectId); }
  if (invoiceRequirement) { itemFilterClauses.push("%alias%.invoice_requirement=?"); itemFilterParams.push(invoiceRequirement); }
  if (itemFilterClauses.length) {
    const existsFilter = itemFilterClauses.map((clause) => clause.replaceAll("%alias%", "fpi")).join(" AND ");
    clauses.push(`EXISTS (SELECT 1 FROM purchase_items fpi WHERE fpi.purchase_document_id=d.id AND ${existsFilter})`);
    params.push(...itemFilterParams);
  }
  if (q) { clauses.push("(d.purchase_group_code LIKE ? OR d.supplier_document_no LIKE ? OR s.name LIKE ? OR EXISTS (SELECT 1 FROM purchase_items qpi WHERE qpi.purchase_document_id=d.id AND qpi.item_name LIKE ?))"); params.push(...Array(4).fill(`%${q}%`)); }
  const where = clauses.join(" AND ");
  const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM purchase_documents d JOIN suppliers s ON s.id=d.supplier_id WHERE ${where}`, params);
  const total = Number((countRows as any[])[0]?.total || 0);
  const joinItemFilter = itemFilterClauses.length
    ? ` AND ${itemFilterClauses.map((clause) => clause.replaceAll("%alias%", "pi")).join(" AND ")}`
    : "";
  const [documents] = await pool.execute(
    `SELECT d.*, s.name AS supplier_name, s.supplier_code,
       COUNT(DISTINCT pi.id) AS item_count, COALESCE(SUM(COALESCE(pi.purchase_total, pi.purchase_subtotal)), 0) AS total_amount
     FROM purchase_documents d JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN purchase_items pi ON pi.purchase_document_id=d.id${joinItemFilter}
     WHERE ${where} GROUP BY d.id ORDER BY d.purchase_date DESC, d.created_at DESC LIMIT ? OFFSET ?`,
    [...itemFilterParams, ...params, pageSize, offset]
  );
  const docs = documents as any[];
  const items = await itemsForDocuments(docs.map((doc) => doc.id), ["TAX_STAFF", "ADMIN"].includes(c.get("user").role));
  const byDocument = new Map<string, any[]>();
  for (const item of items) {
    if (projectId === "none" && item.project_id != null) continue;
    if (projectId && projectId !== "none" && item.project_id !== projectId) continue;
    if (invoiceRequirement && item.invoice_requirement !== invoiceRequirement) continue;
    const list = byDocument.get(item.purchase_document_id) || [];
    list.push(item);
    byDocument.set(item.purchase_document_id, list);
  }
  return c.json({ data: docs.map((doc) => ({ ...doc, items: byDocument.get(doc.id) || [] })), page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.post("/purchase-documents", allowRoles("PURCHASING", "ADMIN"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.supplier_id || !body.purchase_date || !Array.isArray(body.items) || body.items.length < 1) {
    return c.json({ error: "Supplier, tanggal pembelian, dan minimal satu barang wajib diisi." }, 400);
  }
  const sourceType = String(body.source_document_type || "OTHER").toUpperCase();
  if (!sourceTypes.has(sourceType)) return c.json({ error: "Jenis dokumen tidak valid." }, 400);
  const priceTaxMode = String(body.price_tax_mode || "EXCLUSIVE").toUpperCase();
  if (!priceTaxModes.has(priceTaxMode)) return c.json({ error: "Mode harga tidak valid." }, 400);
  let items: any[];
  try { items = body.items.map((item: any, index: number) => normalizeItem(item, index, priceTaxMode)); } catch (error: any) { return c.json({ error: error.message }, 400); }
  const totals = documentTotals(items);
  const id = newId();
  const groupCode = `PUR-${String(body.purchase_date).slice(0, 4)}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO purchase_documents
       (id, purchase_group_code, supplier_id, supplier_document_no, purchase_date, source_document_type, price_tax_mode, document_currency,
        header_subtotal, header_tax_amount, header_total, notes, record_status, created_by, posted_by, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, NOW())` ,
      [id, groupCode, body.supplier_id, body.supplier_document_no || null, body.purchase_date, sourceType,
        priceTaxMode, body.document_currency || "IDR", totals.subtotal, totals.tax,
        totals.total, body.notes || null, c.get("user").id, c.get("user").id]
    );
    await insertItems(conn, id, groupCode, items);
    await writeAudit({ userId: c.get("user").id, action: "CREATE", entityType: "PURCHASE_DOCUMENT", entityId: id, newValues: { purchase_group_code: groupCode, supplier_id: body.supplier_id, purchase_date: body.purchase_date, item_count: items.length } }, conn);
  });
  return c.json({ id, purchase_group_code: groupCode }, 201);
});

router.put("/purchase-documents/:id", allowRoles("PURCHASING", "ADMIN"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (!body.supplier_id || !body.purchase_date || !Array.isArray(body.items) || body.items.length < 1) {
    return c.json({ error: "Supplier, tanggal pembelian, dan minimal satu barang wajib diisi." }, 400);
  }
  const requestedSourceType = body.source_document_type ? String(body.source_document_type).toUpperCase() : null;
  if (requestedSourceType && !sourceTypes.has(requestedSourceType)) return c.json({ error: "Jenis dokumen tidak valid." }, 400);
  const requestedPriceTaxMode = body.price_tax_mode === undefined ? null : String(body.price_tax_mode).toUpperCase();
  if (requestedPriceTaxMode && !priceTaxModes.has(requestedPriceTaxMode)) return c.json({ error: "Mode harga tidak valid." }, 400);
  let items: any[];
  let priceTaxMode = requestedPriceTaxMode || "EXCLUSIVE";

  const outcome = await withTransaction(async (conn) => {
    const [documents] = await conn.execute("SELECT * FROM purchase_documents WHERE id=? FOR UPDATE", [id]);
    const before = (documents as any[])[0];
    if (!before) return { status: "missing" as const };
    priceTaxMode = requestedPriceTaxMode || before.price_tax_mode || "EXCLUSIVE";
    try { items = body.items.map((item: any, index: number) => normalizeItem(item, index, priceTaxMode)); } catch (error: any) { return { status: "invalid" as const, message: error.message }; }
    const totals = documentTotals(items);
    const sourceType = requestedSourceType || before.source_document_type || "OTHER";
    if (before.record_status === "CANCELLED") return { status: "cancelled" as const };
    const [allocationRows] = await conn.execute(
      "SELECT COUNT(*) AS total FROM tax_invoice_purchase_allocations a JOIN purchase_items pi ON pi.id=a.purchase_item_id WHERE pi.purchase_document_id=?",
      [id]
    );
    if (Number((allocationRows as any[])[0]?.total || 0) > 0) return { status: "allocated" as const };
    const [oldItemRows] = await conn.execute("SELECT * FROM purchase_items WHERE purchase_document_id=? ORDER BY item_sequence", [id]);
    const oldItems = (oldItemRows as any[]).map(({ id: itemId, created_at, updated_at, ...row }) => row);
    await conn.execute(
      `UPDATE purchase_documents SET supplier_id=?, supplier_document_no=?, purchase_date=?, source_document_type=?, price_tax_mode=?, document_currency=?,
       header_subtotal=?, header_tax_amount=?, header_total=?, notes=?, record_status='POSTED', posted_by=COALESCE(posted_by, ?), posted_at=COALESCE(posted_at, NOW()) WHERE id=? AND record_status<>'CANCELLED'`,
      [body.supplier_id, body.supplier_document_no || null, body.purchase_date, sourceType, priceTaxMode, body.document_currency || "IDR",
        totals.subtotal, totals.tax, totals.total, body.notes || null, c.get("user").id, id]
    );
    await conn.execute("DELETE FROM purchase_items WHERE purchase_document_id=?", [id]);
    await insertItems(conn, id, before.purchase_group_code, items);
    await writeAudit({
      userId: c.get("user").id, action: "UPDATE", entityType: "PURCHASE_DOCUMENT", entityId: id,
      oldValues: { supplier_id: before.supplier_id, supplier_document_no: before.supplier_document_no, purchase_date: before.purchase_date, source_document_type: before.source_document_type, price_tax_mode: before.price_tax_mode || "EXCLUSIVE", header_subtotal: before.header_subtotal, header_tax_amount: before.header_tax_amount, header_total: before.header_total, notes: before.notes, items: oldItems },
      newValues: { supplier_id: body.supplier_id, supplier_document_no: body.supplier_document_no || null, purchase_date: body.purchase_date, source_document_type: sourceType, price_tax_mode: priceTaxMode, header_subtotal: totals.subtotal, header_tax_amount: totals.tax, header_total: totals.total, notes: body.notes || null, items },
    }, conn);
    return { status: "updated" as const, id, purchase_group_code: before.purchase_group_code };
  });
  if (outcome.status === "missing") return c.json({ error: "Dokumen pembelian tidak ditemukan." }, 404);
  if (outcome.status === "cancelled") return c.json({ error: "Pembelian yang sudah dibatalkan tidak dapat diedit." }, 409);
  if (outcome.status === "allocated") return c.json({ error: "Pembelian tidak bisa diubah karena barangnya sudah terhubung dengan faktur pajak." }, 409);
  if (outcome.status === "invalid") return c.json({ error: outcome.message }, 400);
  return c.json(outcome);
});

router.get("/purchase-documents/:id", async (c) => {
  const [rows] = await pool.execute("SELECT d.*, s.name AS supplier_name, s.supplier_code FROM purchase_documents d JOIN suppliers s ON s.id=d.supplier_id WHERE d.id=? AND d.record_status<>'CANCELLED'", [c.req.param("id")]);
  const document = (rows as any[])[0];
  if (!document) return c.json({ error: "Dokumen pembelian tidak ditemukan." }, 404);
  return c.json({ ...document, items: await itemsForDocuments([document.id], ["TAX_STAFF", "ADMIN"].includes(c.get("user").role)) });
});

router.get("/purchase-items/queue", allowRoles("TAX_STAFF", "ADMIN"), async (c) => {
  const q = c.req.query("q");
  const supplierId = c.req.query("supplierId");
  const projectId = c.req.query("projectId");
  const [docRows] = await pool.query("SELECT id FROM purchase_documents WHERE record_status<>'CANCELLED'");
  const docs = await itemsForDocuments((docRows as any[]).map((row) => row.id), true);
  const filtered = docs.filter((item) => ["WAITING", "PARTIAL", "UNDER_REVIEW", "NEEDS_REVIEW"].includes(item.coverage_status)
    && (item.invoice_requirement !== "NOT_REQUIRED")
    && (!supplierId || item.supplier_id === supplierId)
    && (!projectId || item.project_id === projectId)
    && (!q || `${item.item_code} ${item.item_name} ${item.purchase_group_code} ${item.supplier_name || ""}`.toLowerCase().includes(q.toLowerCase())));
  return c.json(filtered);
});

router.get("/purchase-items/invoice-items", allowRoles("PURCHASING", "TAX_STAFF", "ADMIN"), async (c) => {
  const q = c.req.query("q")?.trim().toLocaleLowerCase();
  const supplierId = c.req.query("supplierId");
  const projectId = c.req.query("projectId");
  const coverage = c.req.query("coverage");
  const includeNonRequired = c.req.query("includeNonRequired") === "1";
  const [docRows] = await pool.query("SELECT id FROM purchase_documents WHERE record_status<>'CANCELLED' ORDER BY purchase_date DESC, created_at DESC");
  const isTaxRole = ["TAX_STAFF", "ADMIN"].includes(c.get("user").role);
  const items = await itemsForDocuments((docRows as any[]).map((row) => row.id), isTaxRole, true, isTaxRole);
  const filtered = items.filter((item) => item.record_status === "ACTIVE"
    && (includeNonRequired || item.invoice_requirement === "REQUIRED")
    && (!supplierId || item.supplier_id === supplierId)
    && (!projectId || item.project_id === projectId)
    && (!coverage || item.coverage_status === coverage)
    && (!q || `${item.item_code} ${item.item_name} ${item.purchase_group_code} ${item.supplier_document_no || ""} ${item.supplier_name || ""} ${item.project_name || ""}`.toLocaleLowerCase().includes(q)
      || item.invoice_links?.some((invoice: any) => String(invoice.nsfp || "").toLocaleLowerCase().includes(q))));
  return c.json(filtered);
});

router.get("/purchase-items/available-for-invoice", allowRoles("TAX_STAFF", "ADMIN"), async (c) => {
  const supplierId = c.req.query("supplierId");
  const excludeInvoiceId = c.req.query("excludeInvoiceId");
  const excludeInvoice = excludeInvoiceId ? " AND ti.id <> ?" : "";
  const params: any[] = [];
  if (excludeInvoiceId) params.push(excludeInvoiceId);
  if (excludeInvoiceId) params.push(excludeInvoiceId);
  const supplierClause = supplierId ? " AND d.supplier_id=?" : "";
  if (supplierId) params.push(supplierId);

  const [rows] = await pool.execute(
    `SELECT pi.*, pr.name AS project_name, d.purchase_group_code, d.purchase_date, d.supplier_id, d.supplier_document_no,
       s.name AS supplier_name, s.supplier_code,
       (SELECT COALESCE(SUM(COALESCE(a.allocated_quantity, pi.quantity)),0) FROM tax_invoice_purchase_allocations a
        JOIN tax_invoice_lines l ON l.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=l.tax_invoice_id
        WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status='VERIFIED'${excludeInvoice}) AS active_quantity,
       (SELECT COALESCE(SUM(COALESCE(a.allocated_quantity, pi.quantity)),0) FROM tax_invoice_purchase_allocations a
        JOIN tax_invoice_lines l ON l.id=a.tax_invoice_line_id JOIN tax_invoices ti ON ti.id=l.tax_invoice_id
        WHERE a.purchase_item_id=pi.id AND ti.lifecycle_status IN ('DRAFT','RECEIVED','UNDER_REVIEW')${excludeInvoice}) AS reserved_quantity
     FROM purchase_items pi
     JOIN purchase_documents d ON d.id=pi.purchase_document_id
     JOIN suppliers s ON s.id=d.supplier_id
     LEFT JOIN projects pr ON pr.id=pi.project_id
     WHERE d.record_status<>'CANCELLED' AND pi.record_status='ACTIVE' AND pi.invoice_requirement='REQUIRED'${supplierClause}
     ORDER BY d.purchase_date DESC, d.purchase_group_code, pi.item_sequence`,
    params
  );

  const available = (rows as any[]).map((item) => {
    const remainingQuantity = Math.max(0, Number(item.quantity) - Number(item.active_quantity) - Number(item.reserved_quantity));
    const remainingDpp = Number(item.quantity) > 0
      ? Math.max(0, Number(item.purchase_subtotal) * remainingQuantity / Number(item.quantity))
      : 0;
    return { ...item, remaining_quantity: remainingQuantity, remaining_dpp: remainingDpp };
  }).filter((item) => item.remaining_quantity > 0.0001);
  return c.json(available);
});

router.get("/purchase-documents/:id/follow-ups", allowRoles("TAX_STAFF", "ADMIN"), async (c) => {
  const [rows] = await pool.execute(
    `SELECT f.*, u.name AS created_by_name FROM follow_up_activities f JOIN users u ON u.id=f.created_by
     WHERE f.purchase_document_id=? ORDER BY f.activity_at DESC`, [c.req.param("id")]
  );
  return c.json(rows);
});

router.post("/purchase-documents/:id/follow-ups", allowRoles("TAX_STAFF", "ADMIN"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (!body.result || !body.channel) return c.json({ error: "Kanal dan hasil follow-up wajib diisi." }, 400);
  const [docRows] = await pool.execute("SELECT id, supplier_id FROM purchase_documents WHERE id=? AND record_status<>'CANCELLED'", [id]);
  const doc = (docRows as any[])[0];
  if (!doc) return c.json({ error: "Dokumen pembelian tidak ditemukan." }, 404);
  const followId = newId();
  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO follow_up_activities (id, purchase_document_id, purchase_item_id, supplier_id, activity_at, channel, contact_person, result, promised_issue_date, next_follow_up_at, created_by)
       VALUES (?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?, ?, ?)`,
      [followId, id, body.purchase_item_id || null, doc.supplier_id, body.activity_at || null, String(body.channel).toUpperCase(), body.contact_person || null, String(body.result).trim(), body.promised_issue_date || null, body.next_follow_up_at || null, c.get("user").id]
    );
    await writeAudit({ userId: c.get("user").id, action: "CREATE", entityType: "FOLLOW_UP", entityId: followId, newValues: { purchase_document_id: id, channel: body.channel } }, conn);
  });
  return c.json({ id: followId }, 201);
});

export default router;
