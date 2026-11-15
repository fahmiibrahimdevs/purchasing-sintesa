import { Hono } from "hono";
import { AppEnv, allowRoles, sessionAuth } from "../auth";
import { newId, pool, withTransaction } from "../db/database";
import { writeAudit } from "../utils/audit";

const router = new Hono<AppEnv>();
router.use("*", sessionAuth);

router.get("/suppliers", async (c) => {
  const [rows] = await pool.query(`SELECT s.id, s.supplier_code, s.name, s.address, s.phone, s.email, s.is_active,
    (SELECT COUNT(*) FROM purchase_documents pd WHERE pd.supplier_id=s.id) AS purchase_count,
    (SELECT COUNT(*) FROM purchase_documents pd WHERE pd.supplier_id=s.id)
      + (SELECT COUNT(*) FROM tax_invoices ti WHERE ti.supplier_id=s.id)
      + (SELECT COUNT(*) FROM follow_up_activities f WHERE f.supplier_id=s.id) AS related_count
    FROM suppliers s ORDER BY s.name`);
  return c.json(rows);
});

router.post("/suppliers", allowRoles("ADMIN"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const code = String(body.supplier_code || `SUP-${crypto.randomUUID().slice(0, 8)}`).trim().toUpperCase();
  if (!name) return c.json({ error: "Nama supplier wajib diisi." }, 400);
  const id = newId();
  await withTransaction(async (conn) => {
    await conn.execute("INSERT INTO suppliers (id, supplier_code, name, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)", [id, code, name, body.address || null, body.phone || null, body.email || null]);
    await writeAudit({ userId: c.get("user").id, action: "CREATE", entityType: "SUPPLIER", entityId: id, newValues: { supplier_code: code, name } }, conn);
  });
  return c.json({ id, supplier_code: code, name }, 201);
});

router.put("/suppliers/:id", allowRoles("ADMIN"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  const [beforeRows] = await pool.execute("SELECT * FROM suppliers WHERE id = ?", [id]);
  const before = (beforeRows as any[])[0];
  if (!before) return c.json({ error: "Supplier tidak ditemukan." }, 404);
  const updated = { supplier_code: String(body.supplier_code ?? before.supplier_code).trim().toUpperCase(), name: String(body.name ?? before.name).trim(), address: body.address ?? before.address, phone: body.phone ?? before.phone, email: body.email ?? before.email, is_active: body.is_active ?? before.is_active };
  if (!updated.name) return c.json({ error: "Nama supplier wajib diisi." }, 400);
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE suppliers SET supplier_code=?, name=?, address=?, phone=?, email=?, is_active=? WHERE id=?", [updated.supplier_code, updated.name, updated.address, updated.phone, updated.email, updated.is_active ? 1 : 0, id]);
    await writeAudit({ userId: c.get("user").id, action: "UPDATE", entityType: "SUPPLIER", entityId: id, oldValues: before, newValues: updated }, conn);
  });
  return c.json({ id, ...updated });
});

router.delete("/suppliers/:id", allowRoles("ADMIN"), async (c) => {
  const id = c.req.param("id");
  let outcome: { status: 204 | 404 | 409; error?: string };
  try {
    outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.execute("SELECT id, supplier_code, name FROM suppliers WHERE id=? FOR UPDATE", [id]);
      const supplier = (rows as any[])[0];
      if (!supplier) return { status: 404, error: "Supplier tidak ditemukan." } as const;
      const [usageRows] = await conn.execute(
        `SELECT (SELECT COUNT(*) FROM purchase_documents WHERE supplier_id=?)
          + (SELECT COUNT(*) FROM tax_invoices WHERE supplier_id=?)
          + (SELECT COUNT(*) FROM follow_up_activities WHERE supplier_id=?) AS related_count`, [id, id, id]
      );
      if (Number((usageRows as any[])[0]?.related_count || 0) > 0) return { status: 409, error: "Supplier masih terkait dengan data pembelian atau faktur. Arsipkan supplier agar riwayat tetap utuh." } as const;
      await conn.execute("DELETE FROM suppliers WHERE id=?", [id]);
      await writeAudit({ userId: c.get("user").id, action: "DELETE", entityType: "SUPPLIER", entityId: id, oldValues: supplier }, conn);
      return { status: 204 } as const;
    });
  } catch (error: any) { return c.json({ error: "Supplier tidak dapat dihapus karena masih dipakai data lain. Arsipkan supplier untuk mempertahankan riwayat." }, 409); }
  if (outcome.status === 404 || outcome.status === 409) return c.json({ error: outcome.error }, outcome.status);
  return c.body(null, 204);
});

router.get("/projects", async (c) => {
  const [rows] = await pool.query(`SELECT p.id, p.project_code, p.name, p.is_active,
    (SELECT COUNT(DISTINCT pi.purchase_document_id) FROM purchase_items pi WHERE pi.project_id=p.id) AS purchase_count,
    (SELECT COUNT(*) FROM purchase_items pi WHERE pi.project_id=p.id) AS related_count
    FROM projects p ORDER BY p.name`);
  return c.json(rows);
});

router.post("/projects", allowRoles("ADMIN"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const code = String(body.project_code || `PRJ-${crypto.randomUUID().slice(0, 8)}`).trim().toUpperCase();
  if (!name) return c.json({ error: "Nama project wajib diisi." }, 400);
  const id = newId();
  await withTransaction(async (conn) => {
    await conn.execute("INSERT INTO projects (id, project_code, name) VALUES (?, ?, ?)", [id, code, name]);
    await writeAudit({ userId: c.get("user").id, action: "CREATE", entityType: "PROJECT", entityId: id, newValues: { project_code: code, name } }, conn);
  });
  return c.json({ id, project_code: code, name }, 201);
});

router.put("/projects/:id", allowRoles("ADMIN"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  const [rows] = await pool.execute("SELECT * FROM projects WHERE id = ?", [id]);
  const before = (rows as any[])[0];
  if (!before) return c.json({ error: "Project tidak ditemukan." }, 404);
  const updated = { project_code: String(body.project_code ?? before.project_code).trim().toUpperCase(), name: String(body.name ?? before.name).trim(), is_active: body.is_active ?? before.is_active };
  if (!updated.name) return c.json({ error: "Nama project wajib diisi." }, 400);
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE projects SET project_code=?, name=?, is_active=? WHERE id=?", [updated.project_code, updated.name, updated.is_active ? 1 : 0, id]);
    await writeAudit({ userId: c.get("user").id, action: "UPDATE", entityType: "PROJECT", entityId: id, oldValues: before, newValues: updated }, conn);
  });
  return c.json({ id, ...updated });
});

router.delete("/projects/:id", allowRoles("ADMIN"), async (c) => {
  const id = c.req.param("id");
  let outcome: { status: 204 | 404 | 409; error?: string };
  try {
    outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.execute("SELECT id, project_code, name FROM projects WHERE id=? FOR UPDATE", [id]);
      const project = (rows as any[])[0];
      if (!project) return { status: 404, error: "Project tidak ditemukan." } as const;
      const [usageRows] = await conn.execute("SELECT COUNT(*) AS related_count FROM purchase_items WHERE project_id=?", [id]);
      if (Number((usageRows as any[])[0]?.related_count || 0) > 0) return { status: 409, error: "Project masih terkait dengan barang pembelian. Arsipkan project agar riwayat tetap utuh." } as const;
      await conn.execute("DELETE FROM projects WHERE id=?", [id]);
      await writeAudit({ userId: c.get("user").id, action: "DELETE", entityType: "PROJECT", entityId: id, oldValues: project }, conn);
      return { status: 204 } as const;
    });
  } catch (error: any) { return c.json({ error: "Project tidak dapat dihapus karena masih dipakai data lain. Arsipkan project untuk mempertahankan riwayat." }, 409); }
  if (outcome.status === 404 || outcome.status === 409) return c.json({ error: outcome.error }, outcome.status);
  return c.body(null, 204);
});

router.get("/users", allowRoles("ADMIN"), async (c) => {
  const [rows] = await pool.query(`SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
    (SELECT COUNT(*) FROM purchase_documents pd WHERE pd.created_by=u.id OR pd.posted_by=u.id) AS purchase_count,
    (SELECT COUNT(*) FROM purchase_documents pd WHERE pd.created_by=u.id OR pd.posted_by=u.id)
      + (SELECT COUNT(*) FROM tax_invoices ti WHERE ti.created_by=u.id OR ti.verified_by=u.id)
      + (SELECT COUNT(*) FROM follow_up_activities f WHERE f.created_by=u.id)
      + (SELECT COUNT(*) FROM tax_invoice_purchase_allocations a WHERE a.created_by=u.id)
      + (SELECT COUNT(*) FROM attachments att WHERE att.uploaded_by=u.id)
      + (SELECT COUNT(*) FROM tax_invoice_events e WHERE e.actor_user_id=u.id) AS related_count
    FROM users u ORDER BY u.name`);
  return c.json(rows);
});

router.post("/users", allowRoles("ADMIN"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "");
  if (!name || !email || password.length < 12 || !["PURCHASING", "TAX_STAFF", "ADMIN"].includes(role)) {
    return c.json({ error: "Nama, email, password minimal 12 karakter, dan salah satu dari tiga role wajib diisi." }, 400);
  }
  const id = newId();
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
  await withTransaction(async (conn) => {
    await conn.execute("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)", [id, name, email, passwordHash, role]);
    await writeAudit({ userId: c.get("user").id, action: "CREATE", entityType: "USER", entityId: id, newValues: { name, email, role } }, conn);
  });
  return c.json({ id, name, email, role }, 201);
});

router.patch("/users/:id", allowRoles("ADMIN"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (id === c.get("user").id && (body.is_active === 0 || body.is_active === false)) return c.json({ error: "Akun Admin yang sedang digunakan tidak dapat dinonaktifkan." }, 400);
  if (body.role && !["PURCHASING", "TAX_STAFF", "ADMIN"].includes(body.role)) return c.json({ error: "Role tidak valid." }, 400);
  const [rows] = await pool.execute("SELECT id, name, email, role, is_active FROM users WHERE id=?", [id]);
  const before = (rows as any[])[0];
  if (!before) return c.json({ error: "Pengguna tidak ditemukan." }, 404);
  const next = { name: String(body.name ?? before.name).trim(), email: String(body.email ?? before.email).trim().toLowerCase(), role: body.role ?? before.role, is_active: body.is_active ?? before.is_active };
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE users SET name=?, email=?, role=?, is_active=? WHERE id=?", [next.name, next.email, next.role, next.is_active ? 1 : 0, id]);
    await writeAudit({ userId: c.get("user").id, action: "UPDATE", entityType: "USER", entityId: id, oldValues: before, newValues: next }, conn);
  });
  return c.json({ id, ...next });
});

router.delete("/users/:id", allowRoles("ADMIN"), async (c) => {
  const id = c.req.param("id");
  if (id === c.get("user").id) return c.json({ error: "Akun yang sedang digunakan tidak dapat dihapus." }, 400);
  let outcome: { status: 204 | 404 | 409; error?: string };
  try {
    outcome = await withTransaction(async (conn) => {
      const [rows] = await conn.execute("SELECT id, name, email, role FROM users WHERE id=? FOR UPDATE", [id]);
      const account = (rows as any[])[0];
      if (!account) return { status: 404, error: "Pengguna tidak ditemukan." } as const;
      const [usageRows] = await conn.execute(
        `SELECT (SELECT COUNT(*) FROM purchase_documents WHERE created_by=? OR posted_by=?)
          + (SELECT COUNT(*) FROM tax_invoices WHERE created_by=? OR verified_by=?)
          + (SELECT COUNT(*) FROM follow_up_activities WHERE created_by=?)
          + (SELECT COUNT(*) FROM tax_invoice_purchase_allocations WHERE created_by=?)
          + (SELECT COUNT(*) FROM attachments WHERE uploaded_by=?)
          + (SELECT COUNT(*) FROM tax_invoice_events WHERE actor_user_id=?) AS related_count`, [id, id, id, id, id, id, id, id]
      );
      if (Number((usageRows as any[])[0]?.related_count || 0) > 0) return { status: 409, error: "Akun masih tercatat pada transaksi atau aktivitas. Arsipkan akun agar riwayat tetap utuh." } as const;
      await conn.execute("DELETE FROM users WHERE id=?", [id]);
      await writeAudit({ userId: c.get("user").id, action: "DELETE", entityType: "USER", entityId: id, oldValues: account }, conn);
      return { status: 204 } as const;
    });
  } catch (error: any) { return c.json({ error: "Akun tidak dapat dihapus karena masih dipakai data lain. Arsipkan akun untuk mempertahankan riwayat." }, 409); }
  if (outcome.status === 404 || outcome.status === 409) return c.json({ error: outcome.error }, outcome.status);
  return c.body(null, 204);
});

export default router;
