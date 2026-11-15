import { Hono } from "hono";
import { logger } from "hono/logger";
import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { runMigrations } from "./db/migrate";
import { pool } from "./db/database";
import authRoutes from "./routes/auth";
import masterRoutes from "./routes/masters";
import purchaseRoutes from "./routes/purchases";
import invoiceRoutes from "./routes/invoices";
import attachmentRoutes from "./routes/attachments";
import reportRoutes from "./routes/reports";

await runMigrations();

const app = new Hono();
app.use("*", logger());
app.get("/api/health", (c) => c.json({ status: "ok", service: "purchasing-tax-invoice" }));
app.route("/api/auth", authRoutes);
app.route("/api", masterRoutes);
app.route("/api", purchaseRoutes);
app.route("/api", invoiceRoutes);
app.route("/api/attachments", attachmentRoutes);
app.route("/api", reportRoutes);

const clientDist = join(import.meta.dir, "../../client/dist");
app.get("*", async (c) => {
  if (!existsSync(join(clientDist, "index.html"))) return c.json({ error: "Frontend belum dibuild. Jalankan bun run build dari root project." }, 404);
  const requested = c.req.path === "/" ? "/index.html" : c.req.path;
  const resolved = resolve(clientDist, requested.replace(/^\//, ""));
  const pathFromClient = relative(clientDist, resolved);
  if (pathFromClient.startsWith("..") || pathFromClient.startsWith("/")) return c.text("Forbidden", 403);
  const file = Bun.file(resolved);
  if (await file.exists()) return new Response(file);
  const index = Bun.file(join(clientDist, "index.html"));
  return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

const port = Number(process.env.PORT || 3006);
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`Purchasing app listening on http://localhost:${server.port}`);

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
process.on("SIGINT", async () => { await pool.end(); process.exit(0); });
