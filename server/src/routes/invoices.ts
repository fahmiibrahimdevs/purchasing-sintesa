import { Hono } from "hono";
import { unlink } from "node:fs/promises";
import { AppEnv, allowRoles, sessionAuth } from "../auth";
import { newId, pool, withTransaction } from "../db/database";
import { activeCancelledAttachmentKeys, activeFileVersionCancellations, eventNewValues } from "../utils/invoiceFileVersions";
import { writeAudit } from "../utils/audit";

const router = new Hono<AppEnv>();
router.use("*", sessionAuth);
const roles = allowRoles("TAX_STAFF", "ADMIN");

function money(value: unknown, label: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} tidak valid.`);
  return String(value);
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function decimal(value: unknown, label: string, nullable = false) {
  if ((value === undefined || value === null || value === "") && nullable) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} tidak valid.`);
  return String(value);
}

async function recordEvent(conn: any, values: { invoiceId: string; eventType: string; actorId: string; reason?: string | null; oldValues?: unknown; newValues?: unknown; relatedInvoiceId?: string | null }) {
  await conn.execute(
    `INSERT INTO tax_invoice_events (id, tax_invoice_id, event_type, actor_user_id, old_values, new_values, reason, related_tax_invoice_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), values.invoiceId, values.eventType, values.actorId,
      values.oldValues === undefined ? null : JSON.stringify(values.oldValues),
      values.newValues === undefined ? null : JSON.stringify(values.newValues),
      values.reason || null, values.relatedInvoiceId || null]
  );
}

async function latestInvoiceVersionIsCancelled(invoiceId: string) {
  const [latestRows] = await pool.execute(
    "SELECT id FROM attachments WHERE tax_invoice_id=? AND category='TAX_INVOICE_PDF' ORDER BY uploaded_at DESC, id DESC LIMIT 1",
    [invoiceId]
  );
  const latestId = (latestRows as any[])[0]?.id;
  if (!latestId) return true;
  const [events] = await pool.execute(
    "SELECT id, event_type, new_values FROM tax_invoice_events WHERE tax_invoice_id=? AND event_type IN ('FILE_VERSION_CANCELLED','FILE_VERSION_RESTORED')",
    [invoiceId]
  );
  return activeFileVersionCancellations(events as any[]).some((event) => String(eventNewValues(event)?.attachment_id || "") === String(latestId));
}

async function getInvoice(id: string) {
  const [rows] = await pool.execute(
    `SELECT ti.*, s.name AS supplier_name, s.supplier_code, u.name AS created_by_name,
       (SELECT r.id FROM tax_invoices r WHERE r.replaces_tax_invoice_id=ti.id AND r.lifecycle_status<>'CANCELLED' ORDER BY r.created_at DESC LIMIT 1) AS replacement_invoice_id,
       (SELECT r.nsfp FROM tax_invoices r WHERE r.replaces_tax_invoice_id=ti.id AND r.lifecycle_status<>'CANCELLED' ORDER BY r.created_at DESC LIMIT 1) AS replacement_nsfp,
       (SELECT r.lifecycle_status FROM tax_invoices r WHERE r.replaces_tax_invoice_id=ti.id AND r.lifecycle_status<>'CANCELLED' ORDER BY r.created_at DESC LIMIT 1) AS replacement_lifecycle_status
     FROM tax_invoices ti JOIN suppliers s ON s.id=ti.supplier_id
     JOIN users u ON u.id=ti.created_by WHERE ti.id=?`, [id]
  );
  const invoice = (rows as any[])[0];
  if (!invoice) return null;
  const invoiceChain = [invoice];
  const seenInvoiceIds = new Set([String(invoice.id)]);
  let parentId = invoice.replaces_tax_invoice_id ? String(invoice.replaces_tax_invoice_id) : "";
  while (parentId && !seenInvoiceIds.has(parentId)) {
    const [parentRows] = await pool.execute(
      `SELECT id, nsfp, invoice_date, replaces_tax_invoice_id FROM tax_invoices WHERE id=?`,
      [parentId]
    );
    const parent = (parentRows as any[])[0];
    if (!parent) break;
    invoiceChain.unshift(parent);
    seenInvoiceIds.add(parentId);
    parentId = parent.replaces_tax_invoice_id ? String(parent.replaces_tax_invoice_id) : "";
  }
  const [lines] = await pool.execute(
    `SELECT l.*, (SELECT JSON_ARRAYAGG(JSON_OBJECT(
       'id', a.id, 'purchase_item_id', pi.id, 'purchase_document_id', d.id,
       'purchase_group_code', d.purchase_group_code, 'supplier_document_no', d.supplier_document_no,
       'purchase_date', d.purchase_date, 'project_name', pr.name, 'item_code', pi.item_code,
       'item_name', pi.item_name, 'quantity', pi.quantity, 'uom', pi.uom,
       'purchase_subtotal', pi.purchase_subtotal, 'purchase_tax_amount', pi.purchase_tax_amount,
       'purchase_total', pi.purchase_total,
       'allocated_quantity', a.allocated_quantity, 'allocated_dpp', a.allocated_dpp,
       'allocated_ppn', a.allocated_ppn, 'allocated_other_tax', a.allocated_other_tax,
       'allocated_total', a.allocated_total, 'allocation_note', a.allocation_note
     )) FROM tax_invoice_purchase_allocations a JOIN purchase_items pi ON pi.id=a.purchase_item_id
       JOIN purchase_documents d ON d.id=pi.purchase_document_id LEFT JOIN projects pr ON pr.id=pi.project_id
       WHERE a.tax_invoice_line_id=l.id) AS allocations
     FROM tax_invoice_lines l WHERE l.tax_invoice_id=? ORDER BY l.line_no`, [id]
  );
  const chainIds = invoiceChain.map((entry) => String(entry.id));
  const chainPlaceholders = chainIds.map(() => "?").join(",");
  const [events] = await pool.execute(
    `SELECT e.*, u.name AS actor_name FROM tax_invoice_events e JOIN users u ON u.id=e.actor_user_id
     WHERE e.tax_invoice_id IN (${chainPlaceholders}) ORDER BY e.event_at DESC, e.id DESC`, chainIds
  );
  const [attachments] = await pool.execute(
    `SELECT a.id, a.tax_invoice_id, a.category, a.original_filename, a.mime_type, a.file_size, a.uploaded_at,
       a.uploaded_by, u.name AS uploaded_by_name, a.supersedes_attachment_id, owner.nsfp AS version_nsfp,
       owner.invoice_date AS version_invoice_date
     FROM attachments a JOIN users u ON u.id=a.uploaded_by
     JOIN tax_invoices owner ON owner.id=a.tax_invoice_id
     WHERE a.tax_invoice_id IN (${chainPlaceholders}) ORDER BY a.uploaded_at ASC, a.id ASC`, chainIds
  );
  const revisionReasons = new Map<string, string>();
  const versionNsfpSnapshots = new Map<string, string>();
  const activeCancellations = activeFileVersionCancellations(events as any[]);
  const versionCancellations = new Map<string, { reason: string; cancelled_at: string; cancelled_by_name: string }>();
  for (const event of events as any[]) {
    const newValues = eventNewValues(event);
    const attachmentId = newValues?.attachment_id;
    const reason = String(event.reason || "").trim();
    if (attachmentId && newValues?.version_nsfp) versionNsfpSnapshots.set(String(attachmentId), String(newValues.version_nsfp));
    if (event.event_type === "FILE_VERSION_UPLOADED" && attachmentId && reason && reason !== "File faktur pajak versi baru diunggah.") {
      revisionReasons.set(String(attachmentId), reason);
    }
  }
  for (const event of activeCancellations) {
    const attachmentId = eventNewValues(event)?.attachment_id;
    const reason = String(event.reason || "").trim();
    if (attachmentId && reason) versionCancellations.set(String(attachmentId), { reason, cancelled_at: event.event_at, cancelled_by_name: event.actor_name });
  }
  const attachmentRows = attachments as any[];
  const invoiceFileVersions = attachmentRows.filter((attachment) => attachment.category === "TAX_INVOICE_PDF");
  const latestAttachmentId = invoiceFileVersions[invoiceFileVersions.length - 1]?.id;
  const invoiceOwnedFileVersions = invoiceFileVersions.filter((attachment) => String(attachment.tax_invoice_id) === String(invoice.id));
  const latestInvoiceAttachmentId = invoiceOwnedFileVersions[invoiceOwnedFileVersions.length - 1]?.id;
  const invoiceChainIndex = new Map(invoiceChain.map((entry, index) => [String(entry.id), index]));
  const attachmentsWithReasons = attachmentRows.map((attachment) => {
    const cancellation = versionCancellations.get(String(attachment.id));
    const versionIndex = invoiceFileVersions.findIndex((version) => version.id === attachment.id);
    const ownerIndex = invoiceChainIndex.get(String(attachment.tax_invoice_id)) || 0;
    const inferredReplacementReason = ownerIndex > 0
      ? `Faktur pengganti dari NSFP ${invoiceChain[ownerIndex - 1]?.nsfp || "sebelumnya"}`
      : "Unggahan awal";
    return {
      ...attachment,
      version_nsfp: versionNsfpSnapshots.get(String(attachment.id)) || attachment.version_nsfp,
      revision_reason: revisionReasons.get(String(attachment.id)) || (attachment.supersedes_attachment_id ? null : inferredReplacementReason),
      version_status: cancellation ? "CANCELLED" : attachment.category !== "TAX_INVOICE_PDF" ? "ACTIVE" : attachment.id === latestAttachmentId ? "ACTIVE" : "SUPERSEDED",
      cancellation_reason: cancellation?.reason || null,
      cancelled_at: cancellation?.cancelled_at || null,
      cancelled_by_name: cancellation?.cancelled_by_name || null,
      version_number: attachment.category === "TAX_INVOICE_PDF" ? versionIndex + 1 : null,
    };
  });
  const latestVersionCancelled = Boolean(latestInvoiceAttachmentId && versionCancellations.has(String(latestInvoiceAttachmentId)));
  return { ...invoice, file_replacement_pending: latestVersionCancelled && !["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status), lines: lines as any[], events: events as any[], attachments: attachmentsWithReasons };
}

router.get("/tax-invoices", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 25)));
  const offset = (page - 1) * pageSize;
  const periodYear = c.req.query("year");
  const periodMonth = c.req.query("month");
  const status = c.req.query("status");
  const q = c.req.query("q");
  const clauses = ["1=1"];
  const params: any[] = [];
  if (periodYear) { clauses.push("ti.tax_period_year=?"); params.push(periodYear); }
  if (periodMonth) { clauses.push("ti.tax_period_month=?"); params.push(periodMonth); }
  if (status) { clauses.push("ti.lifecycle_status=?"); params.push(status); }
  if (q) { clauses.push("(ti.nsfp LIKE ? OR s.name LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const where = clauses.join(" AND ");
  const [counts] = await pool.execute(`SELECT COUNT(*) AS total FROM tax_invoices ti JOIN suppliers s ON s.id=ti.supplier_id WHERE ${where}`, params);
  const total = Number((counts as any[])[0]?.total || 0);
  const [rows] = await pool.execute(
    `SELECT ti.*, s.name AS supplier_name, s.supplier_code,
       (SELECT COUNT(*) FROM tax_invoice_lines l WHERE l.tax_invoice_id=ti.id) AS line_count,
       (SELECT COUNT(DISTINCT a.purchase_item_id) FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines l ON l.id=a.tax_invoice_line_id WHERE l.tax_invoice_id=ti.id) AS item_count,
       (SELECT a.id FROM attachments a WHERE a.tax_invoice_id=ti.id AND a.category='TAX_INVOICE_PDF' ORDER BY a.uploaded_at DESC, a.id DESC LIMIT 1) AS latest_attachment_id
     FROM tax_invoices ti JOIN suppliers s ON s.id=ti.supplier_id
     WHERE ${where} ORDER BY ti.invoice_date DESC, ti.created_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]
  );
  const invoiceRows = rows as any[];
  const invoiceIds = invoiceRows.map((row) => String(row.id));
  const cancelledAttachmentKeys = new Set<string>();
  if (invoiceIds.length) {
    const placeholders = invoiceIds.map(() => "?").join(",");
    const [cancelEvents] = await pool.execute(
      `SELECT id, tax_invoice_id, event_type, new_values FROM tax_invoice_events WHERE event_type IN ('FILE_VERSION_CANCELLED','FILE_VERSION_RESTORED') AND tax_invoice_id IN (${placeholders})`, invoiceIds
    );
    for (const key of activeCancelledAttachmentKeys(cancelEvents as any[])) cancelledAttachmentKeys.add(key);
  }
  const data = invoiceRows.map((row) => ({
    ...row,
    file_replacement_pending: !["CANCELLED", "REPLACED"].includes(row.lifecycle_status) && Boolean(row.latest_attachment_id && cancelledAttachmentKeys.has(`${row.id}:${row.latest_attachment_id}`)),
  }));
  return c.json({ data, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

router.post("/tax-invoices", roles, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.supplier_id || !body.invoice_date || !String(body.nsfp || "").trim() || !Array.isArray(body.lines) || body.lines.length < 1) {
    return c.json({ error: "Supplier, NSFP, tanggal faktur, dan minimal satu baris wajib diisi." }, 400);
  }
  const invoiceId = newId();
  const invoiceDate = String(body.invoice_date);
  const [defaultYear, defaultMonth] = invoiceDate.split("-").map(Number);
  const periodYear = body.tax_period_year === undefined ? defaultYear : Number(body.tax_period_year);
  const periodMonth = body.tax_period_month === undefined ? defaultMonth : Number(body.tax_period_month);
  if (!Number.isInteger(periodYear) || periodYear < 1900 || periodYear > 9999 || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) return c.json({ error: "Masa pajak tidak valid." }, 400);
  let header: any;
  let lines: any[];
  try {
    header = {
      dpp_amount: money(body.dpp_amount, "DPP"), ppn_amount: money(body.ppn_amount, "PPN"),
      other_tax_amount: money(body.other_tax_amount ?? 0, "Komponen pajak lain"), invoice_total: money(body.invoice_total, "Total faktur"),
    };
    lines = body.lines.map((line: any, index: number) => {
      if (!String(line.description || "").trim()) throw new Error(`Deskripsi baris faktur ${index + 1} wajib diisi.`);
      if (!Array.isArray(line.allocations) || !line.allocations.length) throw new Error(`Baris faktur ${index + 1} perlu dialokasikan ke minimal satu barang.`);
      return {
        id: newId(), line_no: index + 1, description: String(line.description).trim(),
        quantity: decimal(line.quantity, `Kuantitas baris ${index + 1}`, true), uom: line.uom || null,
        unit_price: decimal(line.unit_price, `Harga baris ${index + 1}`, true),
        discount_amount: money(line.discount_amount ?? 0, `Diskon baris ${index + 1}`),
        dpp_amount: money(line.dpp_amount, `DPP baris ${index + 1}`), ppn_amount: money(line.ppn_amount, `PPN baris ${index + 1}`),
        other_tax_amount: money(line.other_tax_amount ?? 0, `Pajak lain baris ${index + 1}`), line_total: money(line.line_total, `Total baris ${index + 1}`),
        allocations: line.allocations.map((allocation: any) => ({
          id: newId(), purchase_item_id: String(allocation.purchase_item_id || ""),
          allocated_quantity: decimal(allocation.allocated_quantity, "Kuantitas alokasi", true),
          allocated_dpp: money(allocation.allocated_dpp, "DPP alokasi"), allocated_ppn: money(allocation.allocated_ppn ?? 0, "PPN alokasi"),
          allocated_other_tax: money(allocation.allocated_other_tax ?? 0, "Komponen pajak alokasi"),
          allocated_total: money(allocation.allocated_total, "Total alokasi"), allocation_note: allocation.allocation_note || null,
        })),
      };
    });
  } catch (error: any) { return c.json({ error: error.message }, 400); }

  const invoiceKind = body.invoice_kind === "REPLACEMENT" ? "REPLACEMENT" : body.invoice_kind === "OTHER" ? "OTHER" : "NORMAL";
  if (invoiceKind === "REPLACEMENT" && !body.replaces_tax_invoice_id) return c.json({ error: "Pilih faktur lama yang diganti." }, 400);

  try {
    await withTransaction(async (conn) => {
      const [duplicateRows] = await conn.execute("SELECT id FROM tax_invoices WHERE supplier_id=? AND nsfp=? LIMIT 1", [body.supplier_id, String(body.nsfp).trim()]);
      if ((duplicateRows as any[]).length) throw new Error("NSFP ini sudah tercatat untuk supplier tersebut.");
      if (invoiceKind === "REPLACEMENT") {
        const [oldRows] = await conn.execute("SELECT id, supplier_id, lifecycle_status FROM tax_invoices WHERE id=? FOR UPDATE", [body.replaces_tax_invoice_id]);
        const old = (oldRows as any[])[0];
        if (!old || old.supplier_id !== body.supplier_id || ["CANCELLED", "REPLACED"].includes(old.lifecycle_status)) throw new Error("Faktur lama tidak valid untuk diganti.");
        const [replacementRows] = await conn.execute("SELECT id FROM tax_invoices WHERE replaces_tax_invoice_id=? AND lifecycle_status<>'CANCELLED' LIMIT 1 FOR UPDATE", [body.replaces_tax_invoice_id]);
        if ((replacementRows as any[]).length) throw new Error("Faktur pengganti untuk faktur ini sudah dibuat.");

        await conn.execute("UPDATE tax_invoices SET lifecycle_status='REPLACED' WHERE id=?", [body.replaces_tax_invoice_id]);
        await recordEvent(conn, {
          invoiceId: body.replaces_tax_invoice_id,
          eventType: "REPLACED",
          actorId: c.get("user").id,
          oldValues: { lifecycle_status: old.lifecycle_status },
          newValues: { lifecycle_status: "REPLACED" },
          relatedInvoiceId: invoiceId,
        });
        await writeAudit({
          userId: c.get("user").id,
          action: "MARK_REPLACED",
          entityType: "TAX_INVOICE",
          entityId: body.replaces_tax_invoice_id,
          oldValues: { lifecycle_status: old.lifecycle_status },
          newValues: { lifecycle_status: "REPLACED", replacement_invoice_id: invoiceId },
        }, conn);
      }
      await conn.execute(
        `INSERT INTO tax_invoices (id, supplier_id, nsfp, invoice_date, tax_period_year, tax_period_month,
         dpp_amount, ppn_amount, other_tax_amount, invoice_total, invoice_kind, replaces_tax_invoice_id, lifecycle_status, created_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`,
        [invoiceId, body.supplier_id, String(body.nsfp).trim(), invoiceDate, periodYear, periodMonth,
          header.dpp_amount, header.ppn_amount, header.other_tax_amount, header.invoice_total, invoiceKind,
          invoiceKind === "REPLACEMENT" ? body.replaces_tax_invoice_id : null, c.get("user").id, body.notes || null]
      );
      const requestedByItem = new Map<string, number>();
      const lineTotals = { dpp: 0, ppn: 0, other: 0, total: 0 };
      for (const line of lines) {
        lineTotals.dpp += Number(line.dpp_amount); lineTotals.ppn += Number(line.ppn_amount); lineTotals.other += Number(line.other_tax_amount); lineTotals.total += Number(line.line_total);
        await conn.execute(
          `INSERT INTO tax_invoice_lines (id, tax_invoice_id, line_no, description, quantity, uom, unit_price, discount_amount, dpp_amount, ppn_amount, other_tax_amount, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [line.id, invoiceId, line.line_no, line.description, line.quantity, line.uom, line.unit_price, line.discount_amount, line.dpp_amount, line.ppn_amount, line.other_tax_amount, line.line_total]
        );
        for (const allocation of line.allocations) {
          const [itemRows] = await conn.execute(
            `SELECT pi.id, pi.quantity, pi.purchase_subtotal, pi.invoice_requirement,
               d.id AS source_document_id, d.supplier_id, d.record_status
             FROM purchase_items pi JOIN purchase_documents d ON d.id=pi.purchase_document_id WHERE pi.id=? FOR UPDATE`,
            [allocation.purchase_item_id]
          );
          const item = (itemRows as any[])[0];
          if (!item || item.supplier_id !== body.supplier_id || item.record_status === "CANCELLED") throw new Error("Barang yang dipilih tidak ditemukan atau supplier-nya berbeda.");
          if (item.invoice_requirement !== "REQUIRED") throw new Error("Hanya barang berstatus Faktur yang dapat dialokasikan ke faktur pajak.");

          const replacementExclusion = invoiceKind === "REPLACEMENT" ? " AND ti.id <> ?" : "";
          const allocationParams = invoiceKind === "REPLACEMENT" ? [item.id, body.replaces_tax_invoice_id] : [item.id];
          const [existingRows] = await conn.execute(
            `SELECT COALESCE(SUM(COALESCE(a.allocated_quantity, pi.quantity)),0) AS qty
             FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines l ON l.id=a.tax_invoice_line_id
             JOIN tax_invoices ti ON ti.id=l.tax_invoice_id
             JOIN purchase_items pi ON pi.id=a.purchase_item_id
             WHERE a.purchase_item_id=? AND ti.lifecycle_status IN ('DRAFT','RECEIVED','UNDER_REVIEW','VERIFIED')${replacementExclusion}`,
            allocationParams
          );
          const existing = (existingRows as any[])[0];
          const previousQty = requestedByItem.get(item.id) || 0;
          const nextQty = Number(existing.qty) + previousQty + Number(allocation.allocated_quantity || 0);
          if (nextQty > Number(item.quantity) + 0.0001) throw new Error("Alokasi melebihi sisa kuantitas barang.");
          requestedByItem.set(item.id, previousQty + Number(allocation.allocated_quantity || 0));
          await conn.execute(
            `INSERT INTO tax_invoice_purchase_allocations (id, tax_invoice_line_id, purchase_item_id, allocated_quantity, allocated_dpp, allocated_ppn, allocated_other_tax, allocated_total, allocation_note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [allocation.id, line.id, allocation.purchase_item_id, allocation.allocated_quantity, allocation.allocated_dpp, allocation.allocated_ppn, allocation.allocated_other_tax, allocation.allocated_total, allocation.allocation_note, c.get("user").id]
          );
        }
      }
      const mismatch = Math.abs(lineTotals.dpp - Number(header.dpp_amount)) > 0.01 || Math.abs(lineTotals.ppn - Number(header.ppn_amount)) > 0.01 || Math.abs(lineTotals.total - Number(header.invoice_total)) > 0.01;
      await recordEvent(conn, { invoiceId, eventType: "CREATED", actorId: c.get("user").id, newValues: { nsfp: body.nsfp, invoice_date: invoiceDate, line_count: lines.length, totals_mismatch: mismatch } });
      await writeAudit({ userId: c.get("user").id, action: "CREATE_DRAFT", entityType: "TAX_INVOICE", entityId: invoiceId, newValues: { nsfp: body.nsfp, supplier_id: body.supplier_id, line_count: lines.length, totals_mismatch: mismatch } }, conn);
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Gagal menyimpan faktur." }, 409);
  }
  return c.json(await getInvoice(invoiceId), 201);
});

router.get("/tax-invoices/:id", async (c) => {
  const invoice = await getInvoice(c.req.param("id"));
  return invoice ? c.json(invoice) : c.json({ error: "Faktur tidak ditemukan." }, 404);
});

router.put("/tax-invoices/:id", roles, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const hasItemUpdate = Object.prototype.hasOwnProperty.call(body, "purchase_item_ids");
  if (hasItemUpdate && (!Array.isArray(body.purchase_item_ids) || body.purchase_item_ids.some((itemId: unknown) => typeof itemId !== "string" || !itemId.trim()))) {
    return c.json({ error: "Daftar barang faktur tidak valid." }, 400);
  }
  const purchaseItemIds = hasItemUpdate ? [...new Set((body.purchase_item_ids as string[]).map((itemId) => itemId.trim()))] : undefined;
  if (purchaseItemIds && !purchaseItemIds.length) return c.json({ error: "Pilih minimal satu barang yang tercantum dalam faktur." }, 400);
  const nsfp = String(body.nsfp || "").trim();
  const invoiceDate = String(body.invoice_date || "").trim();
  if (!nsfp || nsfp.length > 100) return c.json({ error: "NSFP wajib diisi dan maksimal 100 karakter." }, 400);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(invoiceDate);
  if (!match) return c.json({ error: "Tanggal faktur tidak valid." }, 400);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const taxPeriodYear = body.tax_period_year === undefined ? year : Number(body.tax_period_year);
  const taxPeriodMonth = body.tax_period_month === undefined ? month : Number(body.tax_period_month);
  if (!Number.isInteger(taxPeriodYear) || taxPeriodYear < 1900 || taxPeriodYear > 9999 || !Number.isInteger(taxPeriodMonth) || taxPeriodMonth < 1 || taxPeriodMonth > 12) {
    return c.json({ error: "Masa pajak tidak valid." }, 400);
  }
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) {
    return c.json({ error: "Tanggal faktur tidak valid." }, 400);
  }

  try {
    await withTransaction(async (conn) => {
      const [invoiceRows] = await conn.execute("SELECT * FROM tax_invoices WHERE id=? FOR UPDATE", [id]);
      const invoice = (invoiceRows as any[])[0];
      if (!invoice || ["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status)) throw new Error("Faktur tidak ditemukan atau sudah tidak dapat diedit.");
      const [duplicateRows] = await conn.execute("SELECT id FROM tax_invoices WHERE supplier_id=? AND nsfp=? AND id<>? LIMIT 1", [invoice.supplier_id, nsfp, id]);
      if ((duplicateRows as any[]).length) throw new Error("NSFP ini sudah tercatat untuk supplier tersebut.");
      if (purchaseItemIds) {
        const [ownRows] = await conn.execute(
          `SELECT a.purchase_item_id,
             SUM(COALESCE(a.allocated_quantity, pi.quantity)) AS allocated_quantity,
             SUM(a.allocated_dpp) AS allocated_dpp, SUM(a.allocated_ppn) AS allocated_ppn,
             SUM(a.allocated_other_tax) AS allocated_other_tax, SUM(a.allocated_total) AS allocated_total
           FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines l ON l.id=a.tax_invoice_line_id
           JOIN purchase_items pi ON pi.id=a.purchase_item_id WHERE l.tax_invoice_id=? GROUP BY a.purchase_item_id`, [id]
        );
        const ownByItem = new Map((ownRows as any[]).map((row) => [String(row.purchase_item_id), row]));
        const updatedItems: any[] = [];
        for (const itemId of purchaseItemIds) {
          const [itemRows] = await conn.execute(
            `SELECT pi.*, d.id AS source_document_id, d.supplier_id, d.record_status AS document_status
             FROM purchase_items pi JOIN purchase_documents d ON d.id=pi.purchase_document_id
             WHERE pi.id=? FOR UPDATE`, [itemId]
          );
          const item = (itemRows as any[])[0];
          if (!item || item.supplier_id !== invoice.supplier_id || item.document_status === "CANCELLED" || item.record_status !== "ACTIVE") {
            throw new Error("Barang yang dipilih tidak ditemukan atau supplier-nya berbeda.");
          }
          if (item.invoice_requirement !== "REQUIRED") throw new Error("Barang bertanda tidak perlu faktur tidak dapat dialokasikan.");

          const [otherRows] = await conn.execute(
            `SELECT COALESCE(SUM(COALESCE(a.allocated_quantity, pi.quantity)),0) AS quantity
             FROM tax_invoice_purchase_allocations a JOIN tax_invoice_lines l ON l.id=a.tax_invoice_line_id
             JOIN tax_invoices ti ON ti.id=l.tax_invoice_id JOIN purchase_items pi ON pi.id=a.purchase_item_id
             WHERE a.purchase_item_id=? AND ti.id<>? AND ti.lifecycle_status IN ('DRAFT','RECEIVED','UNDER_REVIEW','VERIFIED')`, [itemId, id]
          );
          const allocatedByOthers = Number((otherRows as any[])[0]?.quantity || 0);
          const own = ownByItem.get(itemId) as any;
          const quantity = own ? Number(own.allocated_quantity || 0) : Number(item.quantity) - allocatedByOthers;
          if (quantity <= 0.0001 || quantity + allocatedByOthers > Number(item.quantity) + 0.0001) throw new Error(`Kuantitas barang ${item.item_name} sudah digunakan oleh faktur lain.`);
          const ratio = Number(item.quantity) > 0 ? quantity / Number(item.quantity) : 0;
          const dpp = own ? Number(own.allocated_dpp || 0) : roundMoney(Number(item.purchase_subtotal || 0) * ratio);
          const ppn = own ? Number(own.allocated_ppn || 0) : roundMoney(Number(item.purchase_tax_amount || 0) * ratio);
          const otherTax = own ? Number(own.allocated_other_tax || 0) : 0;
          updatedItems.push({
            item, quantity, dpp, ppn, otherTax,
            total: own ? Number(own.allocated_total || 0) : roundMoney(dpp + ppn + otherTax),
          });
        }

        await conn.execute("DELETE FROM tax_invoice_purchase_allocations WHERE tax_invoice_line_id IN (SELECT id FROM tax_invoice_lines WHERE tax_invoice_id=?)", [id]);
        await conn.execute("DELETE FROM tax_invoice_lines WHERE tax_invoice_id=?", [id]);
        const totals = { dpp: 0, ppn: 0, otherTax: 0, total: 0 };
        for (const [index, row] of updatedItems.entries()) {
          const lineId = newId();
          const allocationId = newId();
          const quantity = Number(row.quantity).toFixed(4);
          const dpp = Number(row.dpp).toFixed(2);
          const ppn = Number(row.ppn).toFixed(2);
          const otherTax = Number(row.otherTax).toFixed(2);
          const total = Number(row.total).toFixed(2);
          const unitPrice = (Number(row.quantity) > 0 ? roundMoney(Number(row.dpp) / Number(row.quantity)) : 0).toFixed(2);
          totals.dpp += Number(dpp); totals.ppn += Number(ppn); totals.otherTax += Number(otherTax); totals.total += Number(total);
          await conn.execute(
            `INSERT INTO tax_invoice_lines (id, tax_invoice_id, line_no, description, quantity, uom, unit_price, discount_amount, dpp_amount, ppn_amount, other_tax_amount, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?, '0.00', ?, ?, ?, ?)`,
            [lineId, id, index + 1, row.item.item_name, quantity, row.item.uom, unitPrice, dpp, ppn, otherTax, total]
          );
          await conn.execute(
            `INSERT INTO tax_invoice_purchase_allocations (id, tax_invoice_line_id, purchase_item_id, allocated_quantity, allocated_dpp, allocated_ppn, allocated_other_tax, allocated_total, allocation_note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [allocationId, lineId, row.item.id, quantity, dpp, ppn, otherTax, total, "Koreksi barang terkait pada form edit faktur.", c.get("user").id]
          );
        }

        await conn.execute(
          "UPDATE tax_invoices SET nsfp=?, invoice_date=?, tax_period_year=?, tax_period_month=?, dpp_amount=?, ppn_amount=?, other_tax_amount=?, invoice_total=? WHERE id=?",
          [nsfp, invoiceDate, taxPeriodYear, taxPeriodMonth, roundMoney(totals.dpp).toFixed(2), roundMoney(totals.ppn).toFixed(2), roundMoney(totals.otherTax).toFixed(2), roundMoney(totals.total).toFixed(2), id]
        );
        await recordEvent(conn, {
          invoiceId: id,
          eventType: "UPDATED",
          actorId: c.get("user").id,
          newValues: { nsfp, invoice_date: invoiceDate, tax_period_year: taxPeriodYear, tax_period_month: taxPeriodMonth, item_count: updatedItems.length },
        });
        await writeAudit({
          userId: c.get("user").id, action: "UPDATE", entityType: "TAX_INVOICE", entityId: id,
          oldValues: { nsfp: invoice.nsfp, invoice_date: invoice.invoice_date, tax_period_year: invoice.tax_period_year, tax_period_month: invoice.tax_period_month, dpp_amount: invoice.dpp_amount, ppn_amount: invoice.ppn_amount, invoice_total: invoice.invoice_total },
          newValues: { nsfp, invoice_date: invoiceDate, tax_period_year: taxPeriodYear, tax_period_month: taxPeriodMonth, dpp_amount: roundMoney(totals.dpp).toFixed(2), ppn_amount: roundMoney(totals.ppn).toFixed(2), invoice_total: roundMoney(totals.total).toFixed(2) },
        }, conn);
      } else {
        await conn.execute("UPDATE tax_invoices SET nsfp=?, invoice_date=?, tax_period_year=?, tax_period_month=? WHERE id=?", [nsfp, invoiceDate, taxPeriodYear, taxPeriodMonth, id]);
        await recordEvent(conn, {
          invoiceId: id,
          eventType: "UPDATED",
          actorId: c.get("user").id,
          newValues: { nsfp, invoice_date: invoiceDate, tax_period_year: taxPeriodYear, tax_period_month: taxPeriodMonth },
        });
        await writeAudit({
          userId: c.get("user").id, action: "UPDATE", entityType: "TAX_INVOICE", entityId: id,
          oldValues: { nsfp: invoice.nsfp, invoice_date: invoice.invoice_date, tax_period_year: invoice.tax_period_year, tax_period_month: invoice.tax_period_month },
          newValues: { nsfp, invoice_date: invoiceDate, tax_period_year: taxPeriodYear, tax_period_month: taxPeriodMonth },
        }, conn);
      }
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Data faktur gagal diperbarui." }, 409);
  }
  return c.json(await getInvoice(id));
});

router.delete("/tax-invoices/:id", roles, async (c) => {
  const id = c.req.param("id");
  const storagePaths: string[] = [];
  try {
    await withTransaction(async (conn) => {
      const [invoiceRows] = await conn.execute("SELECT id, nsfp, lifecycle_status FROM tax_invoices WHERE id=? FOR UPDATE", [id]);
      const invoice = (invoiceRows as any[])[0];
      if (!invoice) throw new Error("Faktur tidak ditemukan.");
      if (invoice.lifecycle_status === "REPLACED") {
        throw new Error("Faktur ini sudah pernah digantikan oleh faktur pengganti sehingga tidak dapat dihapus.");
      }

      const [replacementRows] = await conn.execute("SELECT id FROM tax_invoices WHERE replaces_tax_invoice_id=? LIMIT 1 FOR UPDATE", [id]);
      if ((replacementRows as any[]).length) throw new Error("Faktur ini sudah dirujuk oleh faktur pengganti sehingga tidak dapat dihapus.");

      const [fileRows] = await conn.execute("SELECT storage_path FROM attachments WHERE tax_invoice_id=?", [id]);
      storagePaths.push(...(fileRows as any[]).map((row) => String(row.storage_path)));
      await conn.execute("DELETE FROM tax_invoice_purchase_allocations WHERE tax_invoice_line_id IN (SELECT id FROM tax_invoice_lines WHERE tax_invoice_id=?)", [id]);
      await conn.execute("DELETE FROM tax_invoice_events WHERE tax_invoice_id=?", [id]);
      await conn.execute("DELETE FROM attachments WHERE tax_invoice_id=?", [id]);
      await conn.execute("DELETE FROM tax_invoice_lines WHERE tax_invoice_id=?", [id]);
      await conn.execute("DELETE FROM tax_invoices WHERE id=?", [id]);

      await writeAudit({
        userId: c.get("user").id,
        action: "DELETE",
        entityType: "TAX_INVOICE",
        entityId: id,
        oldValues: { nsfp: invoice.nsfp, lifecycle_status: invoice.lifecycle_status },
      }, conn);
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Faktur gagal dihapus." }, 409);
  }
  await Promise.all(storagePaths.map((path) => unlink(path).catch(() => undefined)));
  return c.body(null, 204);
});

router.post("/tax-invoices/:id/submit-review", roles, async (c) => {
  const id = c.req.param("id");
  const [rows] = await pool.execute("SELECT * FROM tax_invoices WHERE id=?", [id]);
  const invoice = (rows as any[])[0];
  if (!invoice) return c.json({ error: "Faktur tidak ditemukan." }, 404);
  if (!['DRAFT', 'RECEIVED'].includes(invoice.lifecycle_status)) return c.json({ error: "Status faktur tidak dapat diajukan untuk verifikasi." }, 409);
  const [files] = await pool.execute("SELECT id FROM attachments WHERE tax_invoice_id=? AND category='TAX_INVOICE_PDF' LIMIT 1", [id]);
  if (!(files as any[]).length) return c.json({ error: "File faktur harus diunggah sebelum diajukan untuk verifikasi." }, 400);
  if (await latestInvoiceVersionIsCancelled(id)) return c.json({ error: "Versi file terbaru sudah dibatalkan. Unggah versi baru sebelum mengajukan faktur." }, 409);
  try {
    await withTransaction(async (conn) => {
      if (invoice.invoice_kind === "REPLACEMENT" && invoice.replaces_tax_invoice_id) {
        const [oldRows] = await conn.execute("SELECT id, supplier_id, lifecycle_status FROM tax_invoices WHERE id=? FOR UPDATE", [invoice.replaces_tax_invoice_id]);
        const old = (oldRows as any[])[0];
        if (!old || old.supplier_id !== invoice.supplier_id || ["CANCELLED", "REPLACED"].includes(old.lifecycle_status)) {
          throw new Error("Faktur lama tidak lagi valid untuk digantikan.");
        }
        const [replacementRows] = await conn.execute(
          "SELECT id FROM tax_invoices WHERE replaces_tax_invoice_id=? AND id<>? AND lifecycle_status<>'CANCELLED' LIMIT 1 FOR UPDATE",
          [invoice.replaces_tax_invoice_id, id]
        );
        if ((replacementRows as any[]).length) throw new Error("Faktur pengganti lain sudah tercatat untuk faktur lama ini.");

        await conn.execute("UPDATE tax_invoices SET lifecycle_status='REPLACED' WHERE id=?", [invoice.replaces_tax_invoice_id]);
        await recordEvent(conn, {
          invoiceId: invoice.replaces_tax_invoice_id,
          eventType: "REPLACED",
          actorId: c.get("user").id,
          oldValues: { lifecycle_status: old.lifecycle_status },
          newValues: { lifecycle_status: "REPLACED" },
          relatedInvoiceId: id,
        });
        await writeAudit({
          userId: c.get("user").id,
          action: "MARK_REPLACED",
          entityType: "TAX_INVOICE",
          entityId: invoice.replaces_tax_invoice_id,
          oldValues: { lifecycle_status: old.lifecycle_status },
          newValues: { lifecycle_status: "REPLACED", replacement_invoice_id: id },
        }, conn);
      }

      await conn.execute("UPDATE tax_invoices SET lifecycle_status='UNDER_REVIEW' WHERE id=?", [id]);
      await recordEvent(conn, { invoiceId: id, eventType: "SUBMITTED", actorId: c.get("user").id, oldValues: { lifecycle_status: invoice.lifecycle_status }, newValues: { lifecycle_status: "UNDER_REVIEW" } });
      await writeAudit({ userId: c.get("user").id, action: "SUBMIT_REVIEW", entityType: "TAX_INVOICE", entityId: id, oldValues: { lifecycle_status: invoice.lifecycle_status }, newValues: { lifecycle_status: "UNDER_REVIEW" } }, conn);
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Faktur gagal dicatat." }, 409);
  }
  return c.json(await getInvoice(id));
});

router.post("/tax-invoices/:id/verify", roles, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const [rows] = await pool.execute("SELECT * FROM tax_invoices WHERE id=?", [id]);
  const invoice = (rows as any[])[0];
  if (!invoice) return c.json({ error: "Faktur tidak ditemukan." }, 404);
  if (!['RECEIVED', 'UNDER_REVIEW'].includes(invoice.lifecycle_status)) return c.json({ error: "Hanya faktur yang sudah diajukan untuk review yang dapat diverifikasi." }, 409);
  const [fileRows] = await pool.execute("SELECT id FROM attachments WHERE tax_invoice_id=? AND category='TAX_INVOICE_PDF' LIMIT 1", [id]);
  if (!(fileRows as any[]).length) return c.json({ error: "File faktur wajib tersedia sebelum verifikasi." }, 400);
  if (await latestInvoiceVersionIsCancelled(id)) return c.json({ error: "Versi file terbaru sudah dibatalkan. Unggah versi baru sebelum faktur diverifikasi." }, 409);
  const [sums] = await pool.execute("SELECT COALESCE(SUM(dpp_amount),0) dpp, COALESCE(SUM(ppn_amount),0) ppn, COALESCE(SUM(line_total),0) total FROM tax_invoice_lines WHERE tax_invoice_id=?", [id]);
  const sum = (sums as any[])[0];
  const mismatch = Math.abs(Number(sum.dpp) - Number(invoice.dpp_amount)) > 0.01 || Math.abs(Number(sum.ppn) - Number(invoice.ppn_amount)) > 0.01 || Math.abs(Number(sum.total) - Number(invoice.invoice_total)) > 0.01;
  if (mismatch && !String(body.reason || "").trim()) return c.json({ error: "Total header dan baris faktur berbeda. Isi alasan untuk melanjutkan verifikasi dengan pengecualian." }, 409);

  await withTransaction(async (conn) => {
    if (invoice.invoice_kind === "REPLACEMENT" && invoice.replaces_tax_invoice_id) {
      const [oldRows] = await conn.execute("SELECT lifecycle_status FROM tax_invoices WHERE id=? FOR UPDATE", [invoice.replaces_tax_invoice_id]);
      const old = (oldRows as any[])[0];
      if (!old) throw new Error("Faktur lama tidak ditemukan.");
      if (old.lifecycle_status !== "REPLACED") {
        const [replacementRows] = await conn.execute("SELECT id FROM tax_invoices WHERE replaces_tax_invoice_id=? AND id<>? AND lifecycle_status<>'CANCELLED' LIMIT 1 FOR UPDATE", [invoice.replaces_tax_invoice_id, id]);
        if ((replacementRows as any[]).length) throw new Error("Ada faktur pengganti lain yang masih aktif untuk faktur lama ini.");
        await conn.execute("UPDATE tax_invoices SET lifecycle_status='REPLACED' WHERE id=?", [invoice.replaces_tax_invoice_id]);
        await recordEvent(conn, { invoiceId: invoice.replaces_tax_invoice_id, eventType: "REPLACED", actorId: c.get("user").id, oldValues: { lifecycle_status: old.lifecycle_status }, newValues: { lifecycle_status: "REPLACED" }, relatedInvoiceId: id, reason: body.reason || null });
      }
    }
    await conn.execute("UPDATE tax_invoices SET lifecycle_status='VERIFIED' WHERE id=?", [id]);
    await recordEvent(conn, { invoiceId: id, eventType: "VERIFIED", actorId: c.get("user").id, oldValues: { lifecycle_status: invoice.lifecycle_status }, newValues: { lifecycle_status: "VERIFIED" }, reason: body.reason || null });
    await writeAudit({ userId: c.get("user").id, action: "VERIFY", entityType: "TAX_INVOICE", entityId: id, oldValues: { lifecycle_status: invoice.lifecycle_status }, newValues: { lifecycle_status: "VERIFIED" }, reason: body.reason || null }, conn);
  });
  return c.json(await getInvoice(id));
});

router.post("/tax-invoices/:id/cancel", roles, async (c) => {
  const id = c.req.param("id");
  const { reason } = await c.req.json().catch(() => ({}));
  if (!String(reason || "").trim()) return c.json({ error: "Alasan pembatalan wajib diisi." }, 400);
  const [rows] = await pool.execute("SELECT * FROM tax_invoices WHERE id=?", [id]);
  const invoice = (rows as any[])[0];
  if (!invoice) return c.json({ error: "Faktur tidak ditemukan." }, 404);
  if (["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status)) return c.json({ error: "Faktur sudah tidak aktif." }, 409);
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE tax_invoices SET lifecycle_status='CANCELLED' WHERE id=?", [id]);
    await recordEvent(conn, { invoiceId: id, eventType: "CANCELLED", actorId: c.get("user").id, oldValues: { lifecycle_status: invoice.lifecycle_status }, newValues: { lifecycle_status: "CANCELLED" }, reason });
    await writeAudit({ userId: c.get("user").id, action: "CANCEL", entityType: "TAX_INVOICE", entityId: id, oldValues: { lifecycle_status: invoice.lifecycle_status }, newValues: { lifecycle_status: "CANCELLED" }, reason }, conn);
  });
  return c.json(await getInvoice(id));
});

router.post("/tax-invoices/:id/attachments/:attachmentId/cancel", roles, async (c) => {
  const invoiceId = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (!reason) return c.json({ error: "Alasan pembatalan versi wajib diisi." }, 400);
  if (reason.length > 500) return c.json({ error: "Alasan pembatalan maksimal 500 karakter." }, 400);

  try {
    await withTransaction(async (conn) => {
      const [invoiceRows] = await conn.execute("SELECT id, lifecycle_status, replaces_tax_invoice_id FROM tax_invoices WHERE id=? FOR UPDATE", [invoiceId]);
      const invoice = (invoiceRows as any[])[0];
      if (!invoice) throw new Error("Faktur tidak ditemukan.");
      if (["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status)) throw new Error("Faktur ini sudah tidak aktif.");

      const [attachmentRows] = await conn.execute(
        "SELECT id FROM attachments WHERE id=? AND tax_invoice_id=? AND category='TAX_INVOICE_PDF' FOR UPDATE",
        [attachmentId, invoiceId]
      );
      if (!(attachmentRows as any[]).length) throw new Error("Versi file tidak ditemukan.");
      const [latestRows] = await conn.execute(
        "SELECT id FROM attachments WHERE tax_invoice_id=? AND category='TAX_INVOICE_PDF' ORDER BY uploaded_at DESC, id DESC LIMIT 1 FOR UPDATE",
        [invoiceId]
      );
      if ((latestRows as any[])[0]?.id !== attachmentId) throw new Error("Hanya versi file terbaru yang dapat dibatalkan.");

      const [existingEvents] = await conn.execute(
        "SELECT id, event_type, new_values FROM tax_invoice_events WHERE tax_invoice_id=? AND event_type IN ('FILE_VERSION_CANCELLED','FILE_VERSION_RESTORED') FOR UPDATE",
        [invoiceId]
      );
      const alreadyCancelled = activeFileVersionCancellations(existingEvents as any[])
        .some((event) => String(eventNewValues(event)?.attachment_id || "") === attachmentId);
      if (alreadyCancelled) throw new Error("Versi file ini sudah dibatalkan.");

      const invoiceChainIds = [String(invoice.id)];
      const seenInvoiceIds = new Set(invoiceChainIds);
      let parentId = invoice.replaces_tax_invoice_id ? String(invoice.replaces_tax_invoice_id) : "";
      while (parentId && !seenInvoiceIds.has(parentId)) {
        const [parentRows] = await conn.execute("SELECT id, replaces_tax_invoice_id FROM tax_invoices WHERE id=? FOR UPDATE", [parentId]);
        const parent = (parentRows as any[])[0];
        if (!parent) break;
        invoiceChainIds.push(String(parent.id));
        seenInvoiceIds.add(String(parent.id));
        parentId = parent.replaces_tax_invoice_id ? String(parent.replaces_tax_invoice_id) : "";
      }
      const chainPlaceholders = invoiceChainIds.map(() => "?").join(",");
      const [countRows] = await conn.execute(
        `SELECT COUNT(*) AS version_count FROM attachments WHERE tax_invoice_id IN (${chainPlaceholders}) AND category='TAX_INVOICE_PDF'`,
        invoiceChainIds
      );
      const versionNumber = Number((countRows as any[])[0]?.version_count || 1);
      const nextLifecycleStatus = invoice.lifecycle_status === "VERIFIED" ? "UNDER_REVIEW" : invoice.lifecycle_status;
      if (nextLifecycleStatus !== invoice.lifecycle_status) {
        await conn.execute("UPDATE tax_invoices SET lifecycle_status='UNDER_REVIEW' WHERE id=?", [invoiceId]);
      }
      await recordEvent(conn, {
        invoiceId,
        eventType: "FILE_VERSION_CANCELLED",
        actorId: c.get("user").id,
        oldValues: { attachment_id: attachmentId, version: versionNumber, version_status: "ACTIVE", lifecycle_status: invoice.lifecycle_status },
        newValues: { attachment_id: attachmentId, version: versionNumber, version_status: "CANCELLED", file_replacement_pending: true, lifecycle_status: nextLifecycleStatus },
        reason,
      });
      await writeAudit({
        userId: c.get("user").id,
        action: "CANCEL_VERSION",
        entityType: "ATTACHMENT",
        entityId: attachmentId,
        oldValues: { version_status: "ACTIVE", lifecycle_status: invoice.lifecycle_status },
        newValues: { version_status: "CANCELLED", file_replacement_pending: true, lifecycle_status: nextLifecycleStatus, version: versionNumber },
        reason,
      }, conn);
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Versi file gagal dibatalkan." }, 409);
  }
  return c.json(await getInvoice(invoiceId));
});

router.post("/tax-invoices/:id/attachments/:attachmentId/restore", roles, async (c) => {
  const invoiceId = c.req.param("id");
  const attachmentId = c.req.param("attachmentId");
  try {
    await withTransaction(async (conn) => {
      const [invoiceRows] = await conn.execute("SELECT id, lifecycle_status FROM tax_invoices WHERE id=? FOR UPDATE", [invoiceId]);
      const invoice = (invoiceRows as any[])[0];
      if (!invoice) throw new Error("Faktur tidak ditemukan.");
      if (["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status)) throw new Error("Faktur ini sudah tidak aktif dan versinya tidak dapat dipulihkan.");

      const [replacementRows] = await conn.execute(
        "SELECT id FROM tax_invoices WHERE replaces_tax_invoice_id=? AND lifecycle_status<>'CANCELLED' LIMIT 1 FOR UPDATE",
        [invoiceId]
      );
      if ((replacementRows as any[]).length) throw new Error("Faktur pengganti sudah dibuat. Versi lama tidak dapat dipulihkan.");

      const [attachmentRows] = await conn.execute(
        "SELECT id FROM attachments WHERE id=? AND tax_invoice_id=? AND category='TAX_INVOICE_PDF' FOR UPDATE",
        [attachmentId, invoiceId]
      );
      if (!(attachmentRows as any[]).length) throw new Error("Versi file tidak ditemukan.");
      const [latestRows] = await conn.execute(
        "SELECT id FROM attachments WHERE tax_invoice_id=? AND category='TAX_INVOICE_PDF' ORDER BY uploaded_at DESC, id DESC LIMIT 1 FOR UPDATE",
        [invoiceId]
      );
      if ((latestRows as any[])[0]?.id !== attachmentId) throw new Error("Hanya versi file terbaru yang dapat dipulihkan.");

      const [eventRows] = await conn.execute(
        "SELECT id, event_type, new_values FROM tax_invoice_events WHERE tax_invoice_id=? AND event_type IN ('FILE_VERSION_CANCELLED','FILE_VERSION_RESTORED') FOR UPDATE",
        [invoiceId]
      );
      const cancellation = activeFileVersionCancellations(eventRows as any[])
        .find((event) => String(eventNewValues(event)?.attachment_id || "") === attachmentId);
      if (!cancellation) throw new Error("Versi file ini tidak sedang dibatalkan.");
      const version = Number(eventNewValues(cancellation)?.version || 1);
      const values = {
        attachment_id: attachmentId,
        version,
        version_status: "ACTIVE",
        restored_cancellation_event_id: cancellation.id,
      };
      await recordEvent(conn, {
        invoiceId,
        eventType: "FILE_VERSION_RESTORED",
        actorId: c.get("user").id,
        oldValues: { attachment_id: attachmentId, version, version_status: "CANCELLED" },
        newValues: values,
        reason: "Pembatalan versi diurungkan.",
      });
      await writeAudit({
        userId: c.get("user").id,
        action: "RESTORE_VERSION",
        entityType: "ATTACHMENT",
        entityId: attachmentId,
        oldValues: { version_status: "CANCELLED" },
        newValues: values,
        reason: "Pembatalan versi diurungkan.",
      }, conn);
    });
  } catch (error: any) {
    return c.json({ error: error.message || "Versi file gagal dipulihkan." }, 409);
  }
  return c.json(await getInvoice(invoiceId));
});

router.post("/tax-invoices/:id/correct", roles, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (!reason) return c.json({ error: "Alasan koreksi wajib diisi." }, 400);
  if (body.nsfp !== undefined || body.dpp_amount !== undefined || body.ppn_amount !== undefined || body.invoice_total !== undefined || body.invoice_date !== undefined) {
    return c.json({ error: "Perubahan data resmi faktur memerlukan record pengganti; koreksi langsung hanya tersedia untuk catatan internal dan masa pajak." }, 409);
  }
  const [rows] = await pool.execute("SELECT * FROM tax_invoices WHERE id=?", [id]);
  const invoice = (rows as any[])[0];
  if (!invoice || ["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status)) return c.json({ error: "Faktur tidak ditemukan atau tidak dapat dikoreksi." }, 404);
  const year = body.tax_period_year === undefined ? invoice.tax_period_year : Number(body.tax_period_year);
  const month = body.tax_period_month === undefined ? invoice.tax_period_month : Number(body.tax_period_month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return c.json({ error: "Masa pajak tidak valid." }, 400);
  const next = { tax_period_year: year, tax_period_month: month, notes: body.notes === undefined ? invoice.notes : body.notes };
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE tax_invoices SET tax_period_year=?, tax_period_month=?, notes=? WHERE id=?", [year, month, next.notes, id]);
    await recordEvent(conn, { invoiceId: id, eventType: "DATA_CORRECTED", actorId: c.get("user").id, oldValues: { tax_period_year: invoice.tax_period_year, tax_period_month: invoice.tax_period_month, notes: invoice.notes }, newValues: next, reason });
    await writeAudit({ userId: c.get("user").id, action: "CORRECT", entityType: "TAX_INVOICE", entityId: id, oldValues: { tax_period_year: invoice.tax_period_year, tax_period_month: invoice.tax_period_month, notes: invoice.notes }, newValues: next, reason }, conn);
  });
  return c.json(await getInvoice(id));
});

export default router;
