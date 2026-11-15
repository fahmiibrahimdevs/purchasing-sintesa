import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./database";

export async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const migrationsPath = join(import.meta.dir, "migrations");
  const files = (await readdir(migrationsPath)).filter((file) => file.endsWith(".sql")).sort();
  const [rows] = await pool.query("SELECT migration_name FROM schema_migrations");
  const applied = new Set((rows as Array<{ migration_name: string }>).map((row) => row.migration_name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsPath, file), "utf8");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(sql);
      await connection.execute("INSERT INTO schema_migrations (migration_name) VALUES (?)", [file]);
      await connection.commit();
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
