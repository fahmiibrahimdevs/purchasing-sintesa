import { pool, newId } from "./database";
import { runMigrations } from "./migrate";

const name = process.env.INITIAL_ADMIN_NAME?.trim() || "Administrator";
const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.INITIAL_ADMIN_PASSWORD;

if (!email || !password || password.length < 12) {
  console.error("Set INITIAL_ADMIN_EMAIL and a 12+ character INITIAL_ADMIN_PASSWORD in server/.env first.");
  process.exit(1);
}

try {
  await runMigrations();
  const [countRows] = await pool.query("SELECT COUNT(*) AS total FROM users");
  const count = Number((countRows as any[])[0]?.total || 0);
  if (count > 0) {
    console.error("User table is not empty; seed:admin only creates the first administrator.");
    process.exitCode = 1;
  } else {
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    await pool.execute("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'ADMIN')", [newId(), name, email, hash]);
    console.log(`Created initial admin account: ${email}`);
  }
} finally {
  await pool.end();
}
