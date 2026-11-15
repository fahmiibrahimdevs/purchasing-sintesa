import { Hono } from "hono";
import { AppEnv, allowRoles, sessionAuth } from "../auth";
import { pool, withTransaction } from "../db/database";
import { activeFileVersionCancellations, eventNewValues } from "../utils/invoiceFileVersions";
import { writeAudit } from "../utils/audit";
import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const router = new Hono<AppEnv>();
router.use("*", sessionAuth);
const storageRoot = resolve(process.env.PRIVATE_STORAGE_PATH || "./storage/private");
const maxFileSize = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);
const allowed = new Map([
  [".pdf", { mime: "application/pdf", signature: (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5)) === "%PDF-" }],
  [".png", { mime: "image/png", signature: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 }],
  [".jpg", { mime: "image/jpeg", signature: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  [".jpeg", { mime: "image/jpeg", signature: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
]);

async function canReadAttachment(attachment: any, role: string) {
  if (attachment.tax_invoice_id) return role === "TAX_STAFF" || role === "ADMIN";
  return ["PURCHASING", "TAX_STAFF", "ADMIN"].includes(role);
}

router.post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const ownerType = String(body.owner_type || "");
  const ownerId = String(body.owner_id || "");
  if (!(file instanceof File) || !ownerId || !["PURCHASE", "TAX_INVOICE"].includes(ownerType)) {
    return c.json({ error: "File dan pemilik dokumen wajib dipilih." }, 400);
  }
  if (file.size < 1 || file.size > maxFileSize) return c.json({ error: `Ukuran file harus 1 byte hingga ${Math.floor(maxFileSize / 1024 / 1024)} MB.` }, 400);
  const ext = extname(file.name).toLowerCase();
  const rule = allowed.get(ext);
  if (!rule) return c.json({ error: "Format file hanya PDF, JPG, atau PNG." }, 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!rule.signature(bytes)) return c.json({ error: "Isi file tidak cocok dengan jenis file yang diunggah." }, 415);

  const role = c.get("user").role;
  if (ownerType === "TAX_INVOICE" && !["TAX_STAFF", "ADMIN"].includes(role)) return c.json({ error: "Hanya Staff Pajak atau Admin yang dapat mengunggah file faktur." }, 403);
  const ownerTable = ownerType === "PURCHASE" ? "purchase_documents" : "tax_invoices";
  const [ownerRows] = await pool.execute(`SELECT id FROM ${ownerTable} WHERE id=?`, [ownerId]);
  if (!(ownerRows as any[]).length) return c.json({ error: "Dokumen tujuan tidak ditemukan." }, 404);

  const id = crypto.randomUUID();
  const safeOriginalName = basename(file.name).replace(/[\r\n\0]/g, "_").slice(0, 255);
  const storageName = `${id}${ext}`;
  const storagePath = resolve(storageRoot, storageName);
  if (!storagePath.startsWith(`${storageRoot}/`)) return c.json({ error: "Lokasi file tidak valid." }, 400);
  await mkdir(storageRoot, { recursive: true });
  await writeFile(storagePath, bytes, { flag: "wx" });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  let supersedesAttachmentId: string | null = null;
  let versionNumber = 1;
  let revisionReason: string | null = null;
  let previousLifecycleStatus = "";
  let versionNsfp = "";
  try {
    await withTransaction(async (conn) => {
      if (ownerType === "TAX_INVOICE") {
        const [invoiceRows] = await conn.execute("SELECT id, nsfp, lifecycle_status, replaces_tax_invoice_id FROM tax_invoices WHERE id=? FOR UPDATE", [ownerId]);
        const invoice = (invoiceRows as any[])[0];
        if (!invoice) throw new Error("Faktur tujuan tidak ditemukan.");
        previousLifecycleStatus = String(invoice.lifecycle_status);
        versionNsfp = String(invoice.nsfp);
        const [ownLatestRows] = await conn.execute(
          "SELECT id FROM attachments WHERE tax_invoice_id=? AND category='TAX_INVOICE_PDF' ORDER BY uploaded_at DESC, id DESC LIMIT 1 FOR UPDATE",
          [ownerId]
        );
        const ownLatestId = (ownLatestRows as any[])[0]?.id;
        if (ownLatestId) {
          const [versionEvents] = await conn.execute(
            "SELECT id, event_type, new_values FROM tax_invoice_events WHERE tax_invoice_id=? AND event_type IN ('FILE_VERSION_CANCELLED','FILE_VERSION_RESTORED') FOR UPDATE",
            [ownerId]
          );
          const latestIsCancelled = activeFileVersionCancellations(versionEvents as any[])
            .some((event) => String(eventNewValues(event)?.attachment_id || "") === String(ownLatestId));
          if (latestIsCancelled) throw new Error("Versi terbaru dibatalkan. Pulihkan versi tersebut atau buat faktur pengganti sebelum mengunggah file.");
        }
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
        const [latestRows] = await conn.execute(
          `SELECT id FROM attachments WHERE tax_invoice_id IN (${chainPlaceholders}) AND category='TAX_INVOICE_PDF' ORDER BY uploaded_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          invoiceChainIds
        );
        const latest = (latestRows as any[])[0];
        supersedesAttachmentId = latest?.id || null;
        const submittedReason = String(body.revision_reason || "").trim();
        if (submittedReason.length > 500) throw new Error("Alasan revisi maksimal 500 karakter.");
        if (latest && !submittedReason) throw new Error("Alasan wajib diisi saat mengunggah versi file faktur yang baru.");
        revisionReason = latest ? submittedReason : "Unggahan awal";
        const [countRows] = await conn.execute(
          `SELECT COUNT(*) AS version_count FROM attachments WHERE tax_invoice_id IN (${chainPlaceholders}) AND category='TAX_INVOICE_PDF'`,
          invoiceChainIds
        );
        versionNumber = Number((countRows as any[])[0]?.version_count || 0) + 1;
      }
      await conn.execute(
        `INSERT INTO attachments (id, purchase_document_id, tax_invoice_id, category, storage_path, original_filename, mime_type, file_size, checksum_sha256, uploaded_by, supersedes_attachment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ownerType === "PURCHASE" ? ownerId : null, ownerType === "TAX_INVOICE" ? ownerId : null,
          ownerType === "PURCHASE" ? "PURCHASE_SOURCE" : "TAX_INVOICE_PDF", storagePath, safeOriginalName, rule.mime, bytes.byteLength, checksum, c.get("user").id,
          ownerType === "TAX_INVOICE" ? supersedesAttachmentId : null]
      );
      if (ownerType === "TAX_INVOICE" && supersedesAttachmentId && previousLifecycleStatus === "VERIFIED") {
        const lifecycleStatus = previousLifecycleStatus;
        await conn.execute("UPDATE tax_invoices SET lifecycle_status='UNDER_REVIEW', verified_by=NULL, verified_at=NULL WHERE id=?", [ownerId]);
        await writeAudit({ userId: c.get("user").id, action: "UPDATE", entityType: "TAX_INVOICE", entityId: ownerId, oldValues: { lifecycle_status: lifecycleStatus }, newValues: { lifecycle_status: "UNDER_REVIEW" }, reason: "Versi file baru diunggah; faktur dikembalikan ke antrean review." }, conn);
      }
      if (ownerType === "TAX_INVOICE") {
        const lifecycleStatus = previousLifecycleStatus;
        await conn.execute(
          `INSERT INTO tax_invoice_events (id, tax_invoice_id, event_type, actor_user_id, old_values, new_values, reason)
           VALUES (?, ?, 'FILE_VERSION_UPLOADED', ?, ?, ?, ?)`,
          [crypto.randomUUID(), ownerId, c.get("user").id,
            JSON.stringify({ lifecycle_status: lifecycleStatus }),
            JSON.stringify({ lifecycle_status: lifecycleStatus === "VERIFIED" && supersedesAttachmentId ? "UNDER_REVIEW" : lifecycleStatus, attachment_id: id, filename: safeOriginalName, version: versionNumber, version_nsfp: versionNsfp }), revisionReason]
        );
      }
      await writeAudit({ userId: c.get("user").id, action: "UPLOAD", entityType: "ATTACHMENT", entityId: id, newValues: { owner_type: ownerType, owner_id: ownerId, filename: safeOriginalName, size: bytes.byteLength, version: ownerType === "TAX_INVOICE" ? versionNumber : undefined, supersedes_attachment_id: supersedesAttachmentId, revision_reason: revisionReason || undefined }, reason: ownerType === "TAX_INVOICE" ? revisionReason : undefined }, conn);
    });
  } catch (error) {
    await unlink(storagePath).catch(() => undefined);
    throw error;
  }
  return c.json({ id, category: ownerType === "PURCHASE" ? "PURCHASE_SOURCE" : "TAX_INVOICE_PDF", original_filename: safeOriginalName, mime_type: rule.mime, file_size: bytes.byteLength, version: ownerType === "TAX_INVOICE" ? versionNumber : undefined, revision_reason: revisionReason }, 201);
});

router.get("/:id/download", async (c) => {
  const [rows] = await pool.execute("SELECT * FROM attachments WHERE id=?", [c.req.param("id")]);
  const attachment = (rows as any[])[0];
  if (!attachment) return c.json({ error: "File tidak ditemukan." }, 404);
  if (!(await canReadAttachment(attachment, c.get("user").role))) return c.json({ error: "Anda tidak memiliki akses ke file ini." }, 403);
  const path = resolve(attachment.storage_path);
  if (!path.startsWith(`${storageRoot}/`)) return c.json({ error: "Path file tidak valid." }, 400);
  const file = Bun.file(path);
  if (!(await file.exists())) return c.json({ error: "File tidak tersedia di penyimpanan." }, 404);
  const encodedName = encodeURIComponent(attachment.original_filename);
  return new Response(file, { headers: {
    "Content-Type": attachment.mime_type,
    "Content-Length": String(attachment.file_size),
    "Content-Disposition": `attachment; filename="document${extname(attachment.original_filename)}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }});
});

router.get("/:id/preview", async (c) => {
  const [rows] = await pool.execute("SELECT * FROM attachments WHERE id=?", [c.req.param("id")]);
  const attachment = (rows as any[])[0];
  if (!attachment) return c.json({ error: "File tidak ditemukan." }, 404);
  if (!(await canReadAttachment(attachment, c.get("user").role))) return c.json({ error: "Anda tidak memiliki akses ke file ini." }, 403);
  if (!["application/pdf", "image/jpeg", "image/png"].includes(attachment.mime_type)) return c.json({ error: "Jenis file ini tidak dapat dipratinjau." }, 415);
  const path = resolve(attachment.storage_path);
  if (!path.startsWith(`${storageRoot}/`)) return c.json({ error: "Path file tidak valid." }, 400);
  const file = Bun.file(path);
  if (!(await file.exists())) return c.json({ error: "File tidak tersedia di penyimpanan." }, 404);
  const encodedName = encodeURIComponent(attachment.original_filename);
  return new Response(file, { headers: {
    "Content-Type": attachment.mime_type,
    "Content-Length": String(attachment.file_size),
    "Content-Disposition": `inline; filename="document${extname(attachment.original_filename)}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }});
});

router.get("/purchase/:id", async (c) => {
  const [rows] = await pool.execute("SELECT id, category, original_filename, mime_type, file_size, uploaded_at FROM attachments WHERE purchase_document_id=? ORDER BY uploaded_at DESC", [c.req.param("id")]);
  return c.json(rows);
});

export default router;
