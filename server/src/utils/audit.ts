import { pool } from "../db/database";

type AuditInput = {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string | null;
};

export async function writeAudit(input: AuditInput, connection: any = pool) {
  await connection.execute(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_values, new_values, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(), input.userId, input.action, input.entityType, input.entityId || null,
      input.oldValues === undefined ? null : JSON.stringify(input.oldValues),
      input.newValues === undefined ? null : JSON.stringify(input.newValues),
      input.reason || null,
    ]
  );
}
