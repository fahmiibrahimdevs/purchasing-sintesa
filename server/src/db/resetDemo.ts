import { readdir, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pool, withTransaction } from "./database";
import { runMigrations } from "./migrate";

const dbHost = process.env.DB_HOST || "127.0.0.1";
const dbName = process.env.DB_NAME || "purchasing_tax_invoice";
const storageRoot = resolve(process.env.PRIVATE_STORAGE_PATH || "./storage/private");

async function main() {
  if (process.env.RESET_DEMO_DATA !== "1") {
    throw new Error("Reset ditolak. Set RESET_DEMO_DATA=1 untuk mengonfirmasi penghapusan data demo lokal.");
  }
  if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "::1"].includes(dbHost) || dbName !== "purchasing_tax_invoice") {
    throw new Error("Reset hanya diizinkan untuk database purchasing_tax_invoice lokal dan non-production.");
  }

  await runMigrations();
  const [userRows] = await pool.execute("SELECT COUNT(*) AS total FROM users WHERE role='ADMIN' AND is_active=1");
  if (Number((userRows as any[])[0]?.total || 0) === 0) throw new Error("Reset dibatalkan karena akun Administrator aktif tidak ditemukan.");
  const [attachmentRows] = await pool.execute("SELECT storage_path FROM attachments");
  const storedFiles = (attachmentRows as any[]).map((row) => String(row.storage_path));

  await withTransaction(async (conn) => {
    for (const table of [
      "audit_logs",
      "attachments",
      "follow_up_activities",
      "tax_invoice_events",
      "tax_invoice_purchase_allocations",
      "tax_invoice_lines",
      "tax_invoices",
      "purchase_items",
      "purchase_documents",
      "projects",
      "suppliers",
    ]) {
      await conn.execute(`DELETE FROM ${table}`);
    }
  });

  let removedFiles = 0;
  for (const filePath of storedFiles) {
    const resolvedPath = resolve(filePath);
    const pathFromStorage = relative(storageRoot, resolvedPath);
    if (!pathFromStorage || pathFromStorage.startsWith("..") || isAbsolute(pathFromStorage)) continue;
    try {
      await unlink(resolvedPath);
      removedFiles++;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const storageFiles = await readdir(storageRoot).catch((error: any) => error.code === "ENOENT" ? [] : Promise.reject(error));
  console.log(JSON.stringify({
    reset: true,
    preserved_admin_users: Number((userRows as any[])[0]?.total || 0),
    removed_attachments: storedFiles.length,
    removed_files: removedFiles,
    remaining_files: storageFiles.length,
  }, null, 2));
}

try {
  await main();
} finally {
  await pool.end();
}
