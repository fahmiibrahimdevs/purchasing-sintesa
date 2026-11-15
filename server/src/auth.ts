import { createMiddleware } from "hono/factory";
import { getCookie, deleteCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db/database";

export type UserRole = "PURCHASING" | "TAX_STAFF" | "ADMIN";
export type AuthUser = { id: string; name: string; email: string; role: UserRole };
export type AppEnv = { Variables: { user: AuthUser; sessionId: string } };

export const sessionCookieName = "pti_session";
export const sessionCookieSecure = process.env.COOKIE_SECURE === "true"
  || (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const sessionAuth = createMiddleware<AppEnv>(async (c, next) => {
  const cookieToken = getCookie(c, sessionCookieName);
  const authorization = c.req.header("Authorization");
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
  const token = cookieToken || bearerToken;
  if (!token) return c.json({ error: "Sesi tidak ditemukan. Silakan login." }, 401);

  const [rows] = await pool.execute(
    `SELECT s.id AS session_id, u.id, u.name, u.email, u.role
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1 LIMIT 1`,
    [hashToken(token)]
  );
  const user = (rows as Array<AuthUser & { session_id: string }>)[0];
  if (!user) {
    deleteCookie(c, sessionCookieName, { path: "/", sameSite: "Lax" });
    return c.json({ error: "Sesi sudah berakhir. Silakan login kembali." }, 401);
  }

  c.set("user", { id: user.id, name: user.name, email: user.email, role: user.role });
  c.set("sessionId", user.session_id);
  await next();
});

export function allowRoles(...roles: UserRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) return c.json({ error: "Anda tidak memiliki akses untuk tindakan ini." }, 403);
    await next();
  });
}

export async function createSession(userId: string, ttlHours: number) {
  const token = randomBytes(32).toString("base64url");
  const sessionId = crypto.randomUUID();
  await pool.execute(
    "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [sessionId, userId, hashToken(token), ttlHours]
  );
  return { token, sessionId };
}

export async function deleteSessionByToken(token: string) {
  await pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [hashToken(token)]);
}

export function clearSessionCookie(c: any) {
  deleteCookie(c, sessionCookieName, { path: "/", sameSite: "Lax", secure: sessionCookieSecure });
}
