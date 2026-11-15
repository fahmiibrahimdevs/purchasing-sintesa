import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { pool, withTransaction } from "../db/database";
import { writeAudit } from "../utils/audit";
import { AppEnv, clearSessionCookie, createSession, sessionAuth, sessionCookieName, sessionCookieSecure, deleteSessionByToken } from "../auth";

const router = new Hono<AppEnv>();

router.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return c.json({ error: "Email dan password wajib diisi." }, 400);

  const [rows] = await pool.execute("SELECT id, name, email, password_hash, role FROM users WHERE email = ? AND is_active = 1 LIMIT 1", [email]);
  const user = (rows as any[])[0];
  if (!user || !(await Bun.password.verify(password, user.password_hash))) {
    return c.json({ error: "Email atau password tidak valid." }, 401);
  }

  const ttlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12));
  const session = await createSession(user.id, ttlHours);
  setCookie(c, sessionCookieName, session.token, {
    httpOnly: true,
    secure: sessionCookieSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: ttlHours * 60 * 60,
  });
  return c.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.get("/me", sessionAuth, (c) => c.json(c.get("user")));

router.patch("/profile", sessionAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const current = c.get("user");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!name || name.length > 200) return c.json({ error: "Nama wajib diisi dan maksimal 200 karakter." }, 400);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "Alamat email tidak valid." }, 400);

  const [rows] = await pool.execute("SELECT name, email FROM users WHERE id = ? LIMIT 1", [current.id]);
  const before = (rows as Array<{ name: string; email: string }>)[0];
  if (!before) return c.json({ error: "Akun tidak ditemukan." }, 404);
  try {
    await withTransaction(async (conn) => {
      await conn.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", [name, email, current.id]);
      await writeAudit({ userId: current.id, action: "UPDATE_PROFILE", entityType: "USER", entityId: current.id, oldValues: before, newValues: { name, email } }, conn);
    });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") return c.json({ error: "Email tersebut sudah digunakan oleh akun lain." }, 409);
    throw error;
  }
  return c.json({ ...current, name, email });
});

router.post("/change-password", sessionAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) return c.json({ error: "Kata sandi saat ini dan kata sandi baru wajib diisi." }, 400);
  if (newPassword.length < 12) return c.json({ error: "Kata sandi baru minimal 12 karakter." }, 400);

  const current = c.get("user");
  const [rows] = await pool.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [current.id]);
  const user = (rows as Array<{ password_hash: string }>)[0];
  if (!user || !(await Bun.password.verify(currentPassword, user.password_hash))) return c.json({ error: "Kata sandi saat ini tidak sesuai." }, 400);
  if (await Bun.password.verify(newPassword, user.password_hash)) return c.json({ error: "Kata sandi baru harus berbeda dari kata sandi saat ini." }, 400);

  const passwordHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
  await withTransaction(async (conn) => {
    await conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, current.id]);
    await conn.execute("DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?", [current.id, c.get("sessionId")]);
    await writeAudit({ userId: current.id, action: "CHANGE_PASSWORD", entityType: "USER", entityId: current.id, reason: "Kata sandi akun diperbarui." }, conn);
  });
  return c.json({ success: true });
});

router.post("/logout", sessionAuth, async (c) => {
  const token = getCookie(c, sessionCookieName) || c.req.header("Authorization")?.replace(/^Bearer\s+/, "");
  if (token) await deleteSessionByToken(token);
  clearSessionCookie(c);
  return c.json({ success: true });
});

export default router;
