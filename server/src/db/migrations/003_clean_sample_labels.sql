UPDATE suppliers
SET supplier_code = REPLACE(supplier_code, 'DUMMY-SUP-', 'SUP-'),
    name = CASE RIGHT(supplier_code, 3)
      WHEN '001' THEN 'CV Sumber Makmur'
      WHEN '002' THEN 'PT Cipta Sarana'
      WHEN '003' THEN 'UD Karya Mandiri'
      WHEN '004' THEN 'PT Sentosa Abadi'
      WHEN '005' THEN 'CV Mitra Niaga'
      WHEN '006' THEN 'PT Andalan Teknik'
      WHEN '007' THEN 'CV Berkah Jaya'
      WHEN '008' THEN 'PT Prima Solusi'
      WHEN '009' THEN 'UD Maju Bersama'
      WHEN '010' THEN 'PT Nusantara Perkasa'
      WHEN '011' THEN 'CV Cahaya Baru'
      WHEN '012' THEN 'PT Graha Utama'
      WHEN '013' THEN 'CV Pilar Kencana'
      WHEN '014' THEN 'PT Sinar Teknologi'
      WHEN '015' THEN 'UD Tiga Saudara'
      WHEN '016' THEN 'PT Bina Usaha'
      WHEN '017' THEN 'CV Karya Sejahtera'
      WHEN '018' THEN 'PT Arta Persada'
      WHEN '019' THEN 'CV Mega Perkasa'
      WHEN '020' THEN 'PT Daya Cipta'
      WHEN '021' THEN 'UD Sumber Rezeki'
      WHEN '022' THEN 'PT Inti Sarana'
      WHEN '023' THEN 'CV Mandiri Jaya'
      WHEN '024' THEN 'PT Pilar Utama'
      WHEN '025' THEN 'CV Bintang Timur'
      WHEN '026' THEN 'PT Kencana Abadi'
      WHEN '027' THEN 'UD Sinar Baru'
      WHEN '028' THEN 'PT Solusi Digital'
      WHEN '029' THEN 'CV Sentosa Teknik'
      WHEN '030' THEN 'PT Harapan Jaya'
      WHEN '031' THEN 'CV Anugerah Niaga'
      WHEN '032' THEN 'PT Mitra Konstruksi'
      WHEN '033' THEN 'UD Cahaya Mandiri'
      WHEN '034' THEN 'PT Global Sarana'
      WHEN '035' THEN 'CV Prima Karya'
      WHEN '036' THEN 'PT Cipta Mandiri'
      ELSE REPLACE(name, '[DUMMY] ', '')
    END,
    email = REPLACE(email, '@dummy.invalid', '@supplier.test')
WHERE supplier_code LIKE 'DUMMY-SUP-%' OR name LIKE '[DUMMY] %' OR email LIKE '%@dummy.invalid';

UPDATE projects
SET project_code = REPLACE(project_code, 'DUMMY-PRJ-', 'PRJ-2026-'),
    name = REPLACE(name, '[DUMMY] ', '')
WHERE project_code LIKE 'DUMMY-PRJ-%' OR name LIKE '[DUMMY] %';

UPDATE purchase_documents
SET purchase_group_code = REPLACE(purchase_group_code, 'DUMMY-PUR-', 'PUR-'),
    supplier_document_no = REPLACE(supplier_document_no, 'DUMMY-NOTA-', 'NOTA-'),
    notes = REPLACE(REPLACE(notes, 'Data dummy; hanya untuk demonstrasi aplikasi.', 'Contoh pencatatan transaksi.'), 'DUMMY', '')
WHERE purchase_group_code LIKE 'DUMMY-PUR-%' OR supplier_document_no LIKE 'DUMMY-NOTA-%' OR notes LIKE '%dummy%' OR notes LIKE '%DUMMY%';

UPDATE purchase_items
SET item_code = REPLACE(item_code, 'DUMMY-PUR-', 'PUR-'),
    item_name = REPLACE(item_name, '[DUMMY] ', ''),
    item_description = REPLACE(item_description, 'dataset demo; bukan data transaksi asli.', 'kebutuhan operasional.'),
    invoice_requirement_reason = REPLACE(REPLACE(invoice_requirement_reason, 'Dummy: skenario tidak meminta faktur.', 'Tidak memerlukan faktur pajak.'), 'Dummy: menunggu konfirmasi kebutuhan faktur.', 'Menunggu konfirmasi kebutuhan faktur.'),
    item_notes = REPLACE(REPLACE(item_notes, 'Data dummy untuk demonstrasi.', 'Contoh pencatatan transaksi.'), 'DUMMY', '')
WHERE item_code LIKE 'DUMMY-PUR-%' OR item_name LIKE '[DUMMY] %' OR item_description LIKE '%demo%' OR invoice_requirement_reason LIKE '%Dummy%' OR item_notes LIKE '%dummy%' OR item_notes LIKE '%DUMMY%';

UPDATE tax_invoices
SET nsfp = REPLACE(REPLACE(nsfp, 'DUMMY-NSFP-R-', 'FP-R-'), 'DUMMY-NSFP-', 'FP-'),
    notes = REPLACE(REPLACE(notes, 'Data dummy; masa pajak simulasi', 'Contoh faktur untuk masa pajak'), 'DUMMY', '')
WHERE nsfp LIKE 'DUMMY-NSFP-%' OR notes LIKE '%dummy%' OR notes LIKE '%DUMMY%';

UPDATE tax_invoice_lines
SET description = REPLACE(description, '[DUMMY] ', '')
WHERE description LIKE '[DUMMY] %';

UPDATE tax_invoice_purchase_allocations
SET allocation_note = REPLACE(allocation_note, 'Dummy: alokasi manual', 'Alokasi manual')
WHERE allocation_note LIKE '%Dummy:%';

UPDATE follow_up_activities
SET result = REPLACE(REPLACE(result, 'Dummy: ', ''), 'DUMMY', '')
WHERE result LIKE '%Dummy:%' OR result LIKE '%DUMMY%';

UPDATE attachments
SET original_filename = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(original_filename,
    'DUMMY-Nota-', 'Nota-'), 'DUMMY-Faktur-', 'Faktur-'), 'DUMMY-PUR-', 'PUR-'), 'DUMMY-NSFP-R-', 'FP-R-'), 'DUMMY-NSFP-', 'FP-')
WHERE original_filename LIKE '%DUMMY%';

UPDATE tax_invoice_events
SET reason = REPLACE(REPLACE(reason, 'Data dummy untuk demonstrasi.', 'Contoh alur pencatatan.'), 'DUMMY', '')
WHERE reason LIKE '%dummy%' OR reason LIKE '%DUMMY%';

UPDATE audit_logs
SET action = IF(action = 'SEED_DEMO_DATA', 'SEED_SAMPLE_DATA', action),
    reason = REPLACE(REPLACE(reason, 'Dataset demo dibuat; seluruh record ditandai DUMMY.', 'Dataset contoh dibuat untuk uji alur aplikasi.'), 'DUMMY', '')
WHERE action = 'SEED_DEMO_DATA' OR reason LIKE '%DUMMY%' OR reason LIKE '%dummy%';
