import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "purchasing_app",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "purchasing_tax_invoice",
  waitForConnections: true,
  connectionLimit: 12,
  queueLimit: 0,
  dateStrings: true,
  multipleStatements: true,
});

export async function withTransaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function newId() {
  return crypto.randomUUID();
}
