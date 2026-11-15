import { newId, pool, withTransaction } from "./database";
import { runMigrations } from "./migrate";

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);
const money = (value: number) => value.toFixed(2);
const sampleSuppliers = [
  { id: newId(), code: "SUP-001", name: "PT Sumber Utama" },
  { id: newId(), code: "SUP-002", name: "CV Mitra Niaga" },
];
const sampleProjects = [
  { id: newId(), code: `PRJ-${year}-01`, name: "Proyek A" },
  { id: newId(), code: `PRJ-${year}-02`, name: "Proyek B" },
  { id: newId(), code: `PRJ-${year}-03`, name: "Proyek C" },
];
const samplePurchases = [
  {
    supplierIndex: 0,
    daysAgo: 4,
    items: [
      { product: "Produk A", projectIndex: 0, quantity: 2, uom: "Unit", unitPrice: 1_500_000 },
      { product: "Produk B", projectIndex: 1, quantity: 5, uom: "Paket", unitPrice: 350_000 },
    ],
  },
  {
    supplierIndex: 0,
    daysAgo: 3,
    items: [
      { product: "Produk C", projectIndex: 2, quantity: 3, uom: "Unit", unitPrice: 825_000 },
      { product: "Produk D", projectIndex: 0, quantity: 1, uom: "Unit", unitPrice: 2_250_000 },
    ],
  },
  {
    supplierIndex: 1,
    daysAgo: 2,
    items: [
      { product: "Produk E", projectIndex: 1, quantity: 4, uom: "Unit", unitPrice: 625_000 },
      { product: "Produk F", projectIndex: 2, quantity: 2, uom: "Paket", unitPrice: 1_100_000 },
    ],
  },
];

function dateDaysAgo(days: number) {
  const date = new Date(`${today}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function main() {
  if ((process.env.DB_NAME || "purchasing_tax_invoice") !== "purchasing_tax_invoice") {
    throw new Error("Seed demo hanya boleh dijalankan untuk database purchasing_tax_invoice.");
  }
  await runMigrations();
  const [adminRows] = await pool.execute("SELECT id FROM users WHERE role='ADMIN' AND is_active=1 ORDER BY created_at LIMIT 1");
  const adminId = (adminRows as any[])[0]?.id;
  if (!adminId) throw new Error("Buat Admin awal sebelum mengisi data demo.");

  const [existingRows] = await pool.execute("SELECT COUNT(*) AS total FROM suppliers");
  if (Number((existingRows as any[])[0]?.total || 0) > 0) {
    console.log("Master data sudah ada; jalankan reset:demo jika ingin mengganti dataset demo.");
    return;
  }

  await withTransaction(async (conn) => {
    for (const supplier of sampleSuppliers) {
      await conn.execute(
        "INSERT INTO suppliers (id, supplier_code, name, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)",
        [supplier.id, supplier.code, supplier.name, "Jl. Contoh No. 1, Jakarta", null, null]
      );
    }
    for (const project of sampleProjects) {
      await conn.execute("INSERT INTO projects (id, project_code, name) VALUES (?, ?, ?)", [project.id, project.code, project.name]);
    }

    for (const [index, purchase] of samplePurchases.entries()) {
      const documentId = newId();
      const purchaseDate = dateDaysAgo(purchase.daysAgo);
      const code = `PUR-${year}-${String(index + 1).padStart(4, "0")}`;
      const noteNumber = `NOTA-${year}-${String(index + 1).padStart(4, "0")}`;
      const subtotal = purchase.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const ppn = Math.round(subtotal * 0.11 * 100) / 100;
      const total = subtotal + ppn;
      await conn.execute(
        `INSERT INTO purchase_documents (id, purchase_group_code, supplier_id, supplier_document_no, purchase_date,
         source_document_type, document_currency, header_subtotal, header_tax_amount, header_total, notes,
         record_status, created_by, posted_by, posted_at)
         VALUES (?, ?, ?, ?, ?, 'INVOICE', 'IDR', ?, ?, ?, ?, 'POSTED', ?, ?, ?)`
        , [documentId, code, sampleSuppliers[purchase.supplierIndex].id, noteNumber, purchaseDate,
          money(subtotal), money(ppn), money(total), "Contoh transaksi untuk demonstrasi.", adminId, adminId, `${purchaseDate} 10:00:00`]
      );
      for (const [itemIndex, item] of purchase.items.entries()) {
        const itemSubtotal = item.quantity * item.unitPrice;
        const itemPpn = Math.round(itemSubtotal * 0.11 * 100) / 100;
        const itemTotal = itemSubtotal + itemPpn;
        const project = sampleProjects[item.projectIndex];
        await conn.execute(
          `INSERT INTO purchase_items (id, purchase_document_id, item_code, item_sequence, project_id, item_name,
           item_description, quantity, uom, unit_price, discount_amount, purchase_subtotal, purchase_tax_amount,
           purchase_total, invoice_requirement, item_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'REQUIRED', ?)`
          , [newId(), documentId, `${code}-${String(itemIndex + 1).padStart(2, "0")}`, itemIndex + 1, project.id, item.product,
            `${item.product} untuk ${project.name}.`, item.quantity, item.uom,
            money(item.unitPrice), money(itemSubtotal), money(itemPpn), money(itemTotal), "Produk demo dengan nama unik."]
        );
      }
    }

    await conn.execute(
      "INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, new_values, reason) VALUES (?, ?, 'SEED_SAMPLE_DATA', 'DATASET', NULL, ?, ?)",
      [newId(), adminId, JSON.stringify({ suppliers: 2, projects: 3, purchases: 3, items: 6, invoices: 0 }), "Dataset demo ringkas; tiap nota berisi beberapa produk bernama unik."]
    );
  });

  console.log(JSON.stringify({ suppliers: 2, projects: 3, purchase_documents: 3, purchase_items: 6, tax_invoices: 0 }, null, 2));
}

try {
  await main();
} finally {
  await pool.end();
}
