import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "./database";

const storageRoot = resolve(process.env.PRIVATE_STORAGE_PATH || "./storage/private");

function makePdf(lines: string[]) {
  const escape = (value: string) => value.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const textOps = ["BT", "/F1 14 Tf", "50 750 Td", ...lines.slice(0, 18).flatMap((line, index) => [index ? "0 -28 Td" : "", `(${escape(line)}) Tj`]), "ET"].filter(Boolean).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(textOps, "ascii")} >>\nstream\n${textOps}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function cleanLine(value: string) {
  return value
    .replaceAll("DUMMY TAX INVOICE - SIMULATION ONLY", "TAX INVOICE SIMULATION")
    .replaceAll("DUMMY PURCHASE SOURCE", "PURCHASE DOCUMENT SAMPLE")
    .replaceAll("NOT A REAL SUPPLIER DOCUMENT", "SAMPLE SUPPLIER DOCUMENT")
    .replaceAll("NOT A VALID TAX DOCUMENT", "SAMPLE TAX DOCUMENT")
    .replaceAll("DUMMY-NSFP-R-", "FP-R-")
    .replaceAll("DUMMY-NSFP-", "FP-")
    .replaceAll("DUMMY-SUP-", "SUP-")
    .replaceAll("DUMMY", "SAMPLE");
}

async function main() {
  const [rows] = await pool.execute(
    "SELECT id, storage_path FROM attachments WHERE original_filename LIKE 'Nota-PUR-2026-%' OR original_filename LIKE 'Faktur-FP-%'",
  );
  let updated = 0;
  for (const row of rows as Array<{ id: string; storage_path: string }>) {
    const path = resolve(row.storage_path);
    if (!path.startsWith(`${storageRoot}/`)) continue;
    const bytes = await readFile(path);
    const raw = bytes.toString("latin1");
    if (!raw.includes("DUMMY")) continue;
    const encodedLines = [...raw.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => match[1]);
    if (!encodedLines.length) continue;
    const lines = encodedLines.map((line) => cleanLine(line.replaceAll("\\(", "(").replaceAll("\\)", ")").replaceAll("\\\\", "\\")));
    const nextBytes = makePdf(lines);
    await writeFile(path, nextBytes, { mode: 0o600 });
    const checksum = createHash("sha256").update(nextBytes).digest("hex");
    await pool.execute("UPDATE attachments SET file_size=?, checksum_sha256=? WHERE id=?", [nextBytes.byteLength, checksum, row.id]);
    updated++;
  }
  console.log(`Updated ${updated} sample PDF files.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
