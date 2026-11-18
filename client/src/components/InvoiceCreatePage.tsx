import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, FileText, FileUp, Search } from "lucide-react";
import { api, dateText, dateTimeText, jsonBody, money, monthText, quantityText } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { PurchaseItem, Supplier, TaxInvoice } from "../types";
import { Button, ErrorBanner, Field, inputClass, LoadingState, SectionHeading } from "./common";
import { SearchableSelect } from "./SearchableSelect";

type InvoiceSourceItem = PurchaseItem & { supplier_document_no?: string };
type PendingInvoiceFile = { file: File; selectedAt: string };

function invoiceVersionFilename(nsfp: string, version: number, originalFilename: string) {
  const safeNsfp = nsfp.trim().replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "faktur";
  const extension = originalFilename.match(/\.(pdf|jpe?g|png)$/i)?.[1]?.toLowerCase() || "pdf";
  return `${safeNsfp}-V${version}.${extension}`;
}

function periodFromInvoiceDate(date: string) {
  const [year = "", month = ""] = date.slice(0, 7).split("-");
  return { year, month: String(Number(month) || "") };
}

function isValidTaxPeriod(year: string, month: string) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  return /^\d{4}$/.test(year) && numericYear >= 1900 && numericYear <= 9999
    && Number.isInteger(numericMonth) && numericMonth >= 1 && numericMonth <= 12;
}

export function InvoiceCreatePage({ initialItem, replacementInvoiceId, onBack, notify, userName }: {
  initialItem?: PurchaseItem | null;
  replacementInvoiceId?: string;
  onBack: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
  userName: string;
}) {
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/api/suppliers") });
  const replacementQuery = useQuery({
    queryKey: ["replacement-source-invoice", replacementInvoiceId],
    queryFn: () => api<TaxInvoice>(`/api/tax-invoices/${replacementInvoiceId}`),
    enabled: Boolean(replacementInvoiceId),
  });
  const availableQuery = useQuery({
    queryKey: ["invoice-items-available", replacementInvoiceId || "normal"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (replacementInvoiceId) params.set("excludeInvoiceId", replacementInvoiceId);
      return api<InvoiceSourceItem[]>(`/api/purchase-items/available-for-invoice?${params}`);
    },
    refetchOnMount: "always",
  });
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [supplierFilterId, setSupplierFilterId] = useState(String(initialItem?.supplier_id || ""));
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsPageSize, setItemsPageSize] = useState(15);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(initialItem ? [initialItem.id] : []);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [taxPeriodYear, setTaxPeriodYear] = useState(String(now.getFullYear()));
  const [taxPeriodMonth, setTaxPeriodMonth] = useState(String(now.getMonth() + 1));
  const [taxPeriodTouched, setTaxPeriodTouched] = useState(false);
  const [nsfp, setNsfp] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<PendingInvoiceFile | null>(null);
  const [replacementReason, setReplacementReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const prefilledReplacementId = useRef("");

  const availableItems = availableQuery.data || [];
  const itemsById = useMemo(() => new Map(availableItems.map((item) => [item.id, item])), [availableItems]);
  const replacementAllocations = useMemo(() => {
    const allocations = new Map<string, { quantity: number; dpp: number; ppn: number; other: number }>();
    for (const line of replacementQuery.data?.lines || []) for (const allocation of line.allocations || []) {
      const current = allocations.get(allocation.purchase_item_id) || { quantity: 0, dpp: 0, ppn: 0, other: 0 };
      current.quantity += Number(allocation.allocated_quantity || 0);
      current.dpp += Number(allocation.allocated_dpp || 0);
      current.ppn += Number(allocation.allocated_ppn || 0);
      current.other += Number(allocation.allocated_other_tax || 0);
      allocations.set(allocation.purchase_item_id, current);
    }
    return allocations;
  }, [replacementQuery.data?.lines]);
  const selectedItems = selectedItemIds.map((id) => itemsById.get(id)).filter((item): item is InvoiceSourceItem => Boolean(item));
  const supplierId = selectedItems[0]?.supplier_id || "";
  const supplier = suppliers.find((row) => row.id === supplierId);
  const supplierFilter = supplierId || supplierFilterId;
  const replacementVersionCount = replacementQuery.data?.attachments?.filter((attachment) => attachment.category === "TAX_INVOICE_PDF").length || 0;
  const pendingVersionNumber = replacementInvoiceId ? replacementVersionCount + 1 : 1;

  useEffect(() => {
    if (initialItem && !replacementInvoiceId) setSelectedItemIds([initialItem.id]);
  }, [initialItem?.id, replacementInvoiceId]);

  useEffect(() => {
    const source = replacementQuery.data;
    if (!replacementInvoiceId || !source || !availableQuery.isSuccess || prefilledReplacementId.current === replacementInvoiceId) return;
    prefilledReplacementId.current = replacementInvoiceId;
    const sourceDate = source.invoice_date.slice(0, 10);
    const period = periodFromInvoiceDate(sourceDate);
    setSupplierFilterId(source.supplier_id);
    setSelectedItemIds([...replacementAllocations.keys()].filter((id) => itemsById.has(id)));
    setInvoiceDate(sourceDate);
    const savedYear = String(source.tax_period_year || period.year);
    const savedMonth = String(source.tax_period_month || period.month);
    setTaxPeriodYear(savedYear);
    setTaxPeriodMonth(savedMonth);
    setTaxPeriodTouched(savedYear !== period.year || savedMonth !== period.month);
  }, [replacementInvoiceId, replacementQuery.data, availableQuery.isSuccess, replacementAllocations, itemsById]);

  useEffect(() => {
    if (availableQuery.isSuccess) setSelectedItemIds((current) => current.filter((id) => itemsById.has(id)));
  }, [availableQuery.isSuccess, itemsById]);

  const visibleItems = useMemo(() => {
    const query = debouncedSearch.toLocaleLowerCase();
    return availableItems.filter((item) => (!replacementInvoiceId || replacementAllocations.has(item.id)) && (!supplierFilter || item.supplier_id === supplierFilter)
      && (!query || `${item.item_name} ${item.supplier_name || ""} ${item.supplier_document_no || ""} ${item.purchase_group_code || ""} ${item.project_name || ""}`.toLocaleLowerCase().includes(query)));
  }, [availableItems, debouncedSearch, supplierFilter, replacementInvoiceId, replacementAllocations]);
  const itemsPageCount = Math.max(1, Math.ceil(visibleItems.length / itemsPageSize));
  const currentItemsPage = Math.min(itemsPage, itemsPageCount);
  const pageItems = useMemo(() => visibleItems.slice((currentItemsPage - 1) * itemsPageSize, currentItemsPage * itemsPageSize), [currentItemsPage, itemsPageSize, visibleItems]);
  const pageNumbers = useMemo(() => {
    if (itemsPageCount <= 7) return Array.from({ length: itemsPageCount }, (_, index) => index + 1);
    const candidates = Array.from(new Set([1, 2, currentItemsPage - 1, currentItemsPage, currentItemsPage + 1, itemsPageCount - 1, itemsPageCount]))
      .filter((page) => page >= 1 && page <= itemsPageCount).sort((a, b) => a - b);
    const pages: Array<number | string> = [];
    candidates.forEach((page, index) => {
      if (index > 0 && page - candidates[index - 1] > 1) pages.push(`ellipsis-${candidates[index - 1]}-${page}`);
      pages.push(page);
    });
    return pages;
  }, [currentItemsPage, itemsPageCount]);
  const visibleItemGroups = useMemo(() => {
    const groups = new Map<string, InvoiceSourceItem[]>();
    for (const item of pageItems) {
      const rows = groups.get(item.purchase_document_id) || [];
      rows.push(item);
      groups.set(item.purchase_document_id, rows);
    }
    return Array.from(groups, ([id, items]) => ({ id, items }));
  }, [pageItems]);

  const selectedDocumentCount = new Set(selectedItems.map((item) => item.purchase_document_id)).size;
  const itemQuantity = (item: InvoiceSourceItem) => replacementAllocations.get(item.id)?.quantity ?? Number(item.remaining_quantity ?? item.quantity ?? 0);
  const itemDpp = (item: InvoiceSourceItem) => {
    const replacementValue = replacementAllocations.get(item.id);
    if (replacementInvoiceId && replacementValue) return Math.round(replacementValue.dpp * 10000) / 10000;
    const amount = item.remaining_dpp == null
      ? Number(item.purchase_subtotal || 0) * (Number(item.quantity) ? itemQuantity(item) / Number(item.quantity) : 0)
      : Number(item.remaining_dpp);
    return Math.round(amount * 10000) / 10000;
  };
  const itemPpn = (item: InvoiceSourceItem) => {
    const replacementValue = replacementAllocations.get(item.id);
    if (replacementInvoiceId && replacementValue) return Math.round(replacementValue.ppn * 10000) / 10000;
    const originalQuantity = Number(item.quantity || 0);
    return Math.round((originalQuantity > 0 ? Number(item.purchase_tax_amount || 0) * itemQuantity(item) / originalQuantity : 0) * 10000) / 10000;
  };
  const dppValue = selectedItems.reduce((sum, item) => sum + itemDpp(item), 0);
  const ppnValue = selectedItems.reduce((sum, item) => sum + itemPpn(item), 0);
  const otherTaxValue = selectedItems.reduce((sum, item) => sum + (replacementAllocations.get(item.id)?.other || 0), 0);
  const invoiceTotal = dppValue + ppnValue + otherTaxValue;
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedItemIds.includes(item.id));
  const someVisibleSelected = visibleItems.some((item) => selectedItemIds.includes(item.id));
  const selectedItemsReady = selectedItems.length > 0 && selectedItems.length === selectedItemIds.length && Boolean(supplierId);
  const replacementItemsReady = !replacementInvoiceId || Boolean(replacementQuery.data && replacementAllocations.size > 0 && selectedItemIds.length === replacementAllocations.size && [...replacementAllocations].every(([id, allocation]) => Number(itemsById.get(id)?.remaining_quantity || 0) + 0.0001 >= allocation.quantity));
  const canSave = Boolean(selectedItemsReady && replacementItemsReady && nsfp.trim() && invoiceDate && isValidTaxPeriod(taxPeriodYear, taxPeriodMonth) && (!replacementInvoiceId || replacementReason.trim()) && !availableQuery.isLoading && !replacementQuery.isLoading);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  useEffect(() => {
    setItemsPage(1);
  }, [debouncedSearch, supplierFilterId, itemsPageSize]);

  useEffect(() => {
    if (itemsPage > itemsPageCount) setItemsPage(itemsPageCount);
  }, [itemsPage, itemsPageCount]);

  function toggleItem(item: InvoiceSourceItem) {
    if (replacementInvoiceId) return;
    setSelectedItemIds((current) => current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : current.some((id) => itemsById.get(id)?.supplier_id !== item.supplier_id) ? current : [...current, item.id]);
  }

  function toggleAllVisible() {
    if (!supplierFilter || replacementInvoiceId) return;
    const visibleIds = visibleItems.map((item) => item.id);
    setSelectedItemIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  }

  function clearSelection() {
    setSelectedItemIds([]);
    setSupplierFilterId("");
    setError("");
  }

  function changeInvoiceDate(value: string) {
    setInvoiceDate(value);
    if (!taxPeriodTouched && value) {
      const period = periodFromInvoiceDate(value);
      setTaxPeriodYear(period.year);
      setTaxPeriodMonth(period.month);
    }
  }

  async function save() {
    setError("");
    setSaving(true);
    let createdInvoiceId = "";
    try {
      if (!supplierId || !selectedItemsReady) throw new Error("Pilih minimal satu barang dari pembelian.");
      if (!replacementItemsReady) throw new Error("Barang atau kuantitas dari faktur lama tidak lagi tersedia untuk dialihkan.");
      if (!nsfp.trim()) throw new Error("NSFP wajib diisi.");
      if (replacementInvoiceId && !replacementReason.trim()) throw new Error("Alasan faktur pengganti wajib diisi.");
      if (!isValidTaxPeriod(taxPeriodYear, taxPeriodMonth)) throw new Error("Masa Pajak harus berisi bulan dan tahun yang valid.");

      const lines = selectedItems.map((item) => {
        const quantity = itemQuantity(item);
        const lineDpp = itemDpp(item);
        const linePpn = itemPpn(item);
        const lineTotal = lineDpp + linePpn;
        return {
          description: item.item_name,
          quantity: quantity.toFixed(4),
          uom: item.uom,
          unit_price: (quantity > 0 ? lineDpp / quantity : 0).toFixed(4),
          discount_amount: "0.0000",
          dpp_amount: lineDpp.toFixed(4),
          ppn_amount: linePpn.toFixed(4),
          other_tax_amount: (replacementAllocations.get(item.id)?.other || 0).toFixed(4),
          line_total: (lineTotal + (replacementAllocations.get(item.id)?.other || 0)).toFixed(4),
          allocations: [{
            purchase_item_id: item.id,
            allocated_quantity: quantity.toFixed(4),
            allocated_dpp: lineDpp.toFixed(4),
            allocated_ppn: linePpn.toFixed(4),
            allocated_other_tax: (replacementAllocations.get(item.id)?.other || 0).toFixed(4),
            allocated_total: (lineTotal + (replacementAllocations.get(item.id)?.other || 0)).toFixed(4),
            allocation_note: "Nilai barang mengikuti data nota pembelian.",
          }],
        };
      });
      const payload = {
        supplier_id: supplierId,
        nsfp: nsfp.trim(),
        invoice_date: invoiceDate,
        tax_period_year: Number(taxPeriodYear),
        tax_period_month: Number(taxPeriodMonth),
        dpp_amount: dppValue.toFixed(4),
        ppn_amount: ppnValue.toFixed(4),
        other_tax_amount: otherTaxValue.toFixed(4),
        invoice_total: invoiceTotal.toFixed(4),
        invoice_kind: replacementInvoiceId ? "REPLACEMENT" : "NORMAL",
        ...(replacementInvoiceId ? { replaces_tax_invoice_id: replacementInvoiceId } : {}),
        lines,
      };
      const invoice = await api<TaxInvoice>("/api/tax-invoices", { method: "POST", body: jsonBody(payload) });
      createdInvoiceId = invoice.id;
      if (invoiceFile) {
        const form = new FormData();
        form.append("file", invoiceFile.file, invoiceVersionFilename(nsfp, pendingVersionNumber, invoiceFile.file.name));
        form.append("owner_type", "TAX_INVOICE");
        form.append("owner_id", invoice.id);
        if (replacementReason.trim()) form.append("revision_reason", replacementReason.trim());
        await api("/api/attachments", { method: "POST", body: form });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items-available"] }),
        queryClient.invalidateQueries({ queryKey: ["purchases"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["report"] }),
      ]);
      notify(replacementInvoiceId ? "Faktur pengganti tercatat. Faktur sebelumnya ditandai digantikan." : "Faktur berhasil dicatat.", "success");
      onBack();
    } catch (err: any) {
      if (createdInvoiceId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["invoices"] }),
          queryClient.invalidateQueries({ queryKey: ["invoice-queue"] }),
          queryClient.invalidateQueries({ queryKey: ["invoice-items"] }),
          queryClient.invalidateQueries({ queryKey: ["invoice-items-available"] }),
        ]);
        notify(`Draft faktur sudah dibuat, tetapi unggah atau pengajuan gagal: ${err.message}. Lanjutkan dari detail faktur.`, "error");
        onBack();
      } else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-5">
    <SectionHeading title={replacementInvoiceId ? "Input Faktur Pajak Pengganti" : "Input Faktur Pajak"} description={replacementInvoiceId ? "Catat NSFP baru dari supplier sebagai pengganti faktur sebelumnya." : "Cari barang dari pembelian, pilih yang tercantum dalam faktur, lalu unggah file dari pemasok."} action={<Button variant="secondary" disabled={saving} onClick={onBack}><ArrowLeft size={15} />Kembali ke Faktur Pajak</Button>} />
    <div className="space-y-4">
      <ErrorBanner message={error || (availableQuery.error instanceof Error ? availableQuery.error.message : null) || (replacementQuery.error instanceof Error ? replacementQuery.error.message : null)} />
      {replacementInvoiceId && replacementQuery.data && <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-3 text-sm text-violet-950"><p className="font-semibold">Faktur pengganti untuk {replacementQuery.data.nsfp}</p><p className="mt-0.5 text-xs leading-relaxed text-violet-800">Barang, kuantitas, dan nilai mengikuti faktur lama. Isi NSFP baru dari supplier. Setelah faktur pengganti berhasil dicatat, faktur lama otomatis berstatus Digantikan dan tetap tersimpan sebagai riwayat.</p>{!replacementItemsReady && availableQuery.isSuccess && replacementQuery.isSuccess && <p className="mt-1 text-xs font-medium text-rose-700">Sebagian barang atau kuantitas dari faktur lama tidak lagi tersedia untuk dialihkan. Periksa alokasi barang sebelum membuat pengganti.</p>}</div>}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-3">
          <div className="mb-4"><h3 className="text-sm font-semibold text-slate-900">Filter barang</h3><p className="mt-0.5 text-xs text-slate-500">Cari berdasarkan nama barang, toko, nota, atau project.</p></div>
          <div className="space-y-4">
            <Field label="Pencarian"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari barang, nota, project…" /></div></Field>
            <Field label="Nama toko / pemasok"><SearchableSelect className={inputClass} value={supplierFilter} placeholder="Semua toko" searchPlaceholder="Cari nama toko…" options={suppliers.filter((row) => row.is_active).map((row) => ({ value: row.id, label: row.name, sublabel: row.supplier_code }))} disabled={Boolean(supplierId)} onChange={setSupplierFilterId} /></Field>
            <p className="text-xs leading-relaxed text-slate-500">{supplierId ? `Pilihan dikunci ke ${supplier?.name || "toko ini"} selama barang faktur dipilih.` : "Setelah barang pertama dipilih, toko faktur akan terkunci. Satu faktur dapat mencakup beberapa nota dari toko yang sama."}</p>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 xl:col-span-9">
          <div className="mb-4 flex items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">A</span><div><h3 className="text-sm font-semibold text-slate-900">Pilih barang dari pembelian</h3><p className="text-xs text-slate-500">{replacementInvoiceId ? "Barang, kuantitas, dan nilai dari faktur lama diterapkan otomatis." : "Tandai barang yang tercantum dalam faktur pajak."}</p></div></div>
          {selectedItems.length > 0 && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-sm"><div><span className="font-semibold text-blue-900">{selectedItems.length} barang dipilih</span><span className="text-blue-800"> · {selectedDocumentCount} nota · {supplier?.name}</span></div>{!replacementInvoiceId && <button type="button" className="text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline" onClick={clearSelection}>Batalkan pilihan</button>}</div>}
          {availableQuery.isLoading ? <LoadingState label="Mengambil barang yang belum tertaut faktur…" compact />
            : !availableItems.length ? <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">Belum ada barang berstatus Faktur yang belum ditautkan ke faktur pajak.</p>
            : !visibleItems.length ? <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">Tidak ada barang yang cocok dengan pencarian atau toko ini.</p>
            : <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2.5"><span className="text-xs text-slate-600">{visibleItems.length} barang tersedia{supplierFilter && selectedItems.length === 0 ? ` · ${suppliers.find((row) => row.id === supplierFilter)?.name || "Pemasok terpilih"}` : ""}</span><span className="text-xs text-slate-600">{selectedItems.length} dipilih dari {availableItems.length}</span></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[925px] table-fixed text-left text-sm">
              <colgroup><col className="w-[42px]" /><col className="w-[135px]" /><col className="w-[160px]" /><col className="w-[65px]" /><col className="w-[58px]" /><col className="w-[115px]" /><col className="w-[125px]" /><col className="w-[100px]" /><col className="w-[125px]" /></colgroup>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-3 text-center"><input ref={selectAllRef} aria-label="Pilih semua barang yang terlihat" title={supplierFilter ? "Pilih semua barang pemasok ini" : "Pilih pemasok atau barang pertama dahulu"} type="checkbox" checked={allVisibleSelected} disabled={!supplierFilter || !visibleItems.length || Boolean(replacementInvoiceId)} onChange={toggleAllVisible} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40" /></th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Nama barang</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3">UOM</th><th className="px-3 py-3 text-right">Harga</th><th className="px-3 py-3 text-right">Sub total</th><th className="px-3 py-3 text-right">PPN</th><th className="px-3 py-3 text-right">Total</th></tr></thead>
              {visibleItemGroups.map(({ id, items }) => {
                const note = items[0];
                return <tbody key={id} className="divide-y divide-slate-100">
                  <tr className="border-y border-slate-200 bg-slate-50/90">
                    <td colSpan={9} className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs">
                        <span className="font-semibold text-slate-900">{note.supplier_document_no || note.purchase_group_code || "Nota pembelian"}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-slate-500">{note.purchase_group_code || "—"}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="font-medium text-slate-600">{note.supplier_name || "—"}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-slate-500">{dateText(note.purchase_date || "")}</span>
                        <span className="ml-auto shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">{items.length} barang</span>
                      </div>
                    </td>
                  </tr>
                  {items.map((item) => {
                    const checked = selectedItemIds.includes(item.id);
                    const subtotal = itemDpp(item);
                    const tax = itemPpn(item);
                    return <tr key={item.id} className={`transition ${checked ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"}`}>
                      <td className="px-3 py-2.5 text-center"><input aria-label={`Pilih ${item.item_name} dari ${item.supplier_document_no || item.purchase_group_code}`} type="checkbox" checked={checked} disabled={Boolean(replacementInvoiceId)} onChange={() => toggleItem(item)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td>
                      <td className="whitespace-normal break-words px-3 py-2.5 text-slate-700">{item.project_name || "Tanpa project"}</td>
                      <td className="whitespace-normal break-words px-3 py-2.5 font-medium text-slate-900">{item.item_name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800" title="Jumlah sesuai nota pembelian">{quantityText(itemQuantity(item))}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{item.uom}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">{money(itemQuantity(item) > 0 ? subtotal / itemQuantity(item) : 0)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">{money(subtotal)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">{money(tax)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-slate-900">{money(subtotal + tax + (replacementAllocations.get(item.id)?.other || 0))}</td>
                    </tr>;
                  })}
                </tbody>;
              })}
            </table></div>
            {!supplierFilter && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Pilih pemasok untuk memilih semua barang sekaligus. Setelah barang pertama dipilih, pemasok faktur akan otomatis terkunci.</p>}
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
                <span>Menampilkan <strong className="font-semibold text-slate-800">{(currentItemsPage - 1) * itemsPageSize + 1} - {Math.min(currentItemsPage * itemsPageSize, visibleItems.length)}</strong> dari {visibleItems.length} data</span>
                <label className="flex items-center gap-2" htmlFor="invoice-items-page-size">Per hal:
                  <select id="invoice-items-page-size" value={itemsPageSize} onChange={(event) => setItemsPageSize(Number(event.target.value))} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                    {[15, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
              </div>
              <nav aria-label="Halaman barang pembelian" className="flex items-center gap-1 self-end sm:self-auto">
                <button type="button" aria-label="Halaman pertama" title="Halaman pertama" disabled={currentItemsPage === 1} onClick={() => setItemsPage(1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronsLeft size={15} /></button>
                <button type="button" aria-label="Halaman sebelumnya" title="Halaman sebelumnya" disabled={currentItemsPage === 1} onClick={() => setItemsPage(currentItemsPage - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={15} /></button>
                {pageNumbers.map((page) => typeof page === "number"
                  ? <button key={page} type="button" aria-label={`Halaman ${page}`} aria-current={currentItemsPage === page ? "page" : undefined} onClick={() => setItemsPage(page)} className={`grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-xs font-medium transition ${currentItemsPage === page ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{page}</button>
                  : <span key={page} aria-hidden="true" className="px-1 text-xs text-slate-400">…</span>)}
                <button type="button" aria-label="Halaman berikutnya" title="Halaman berikutnya" disabled={currentItemsPage === itemsPageCount} onClick={() => setItemsPage(currentItemsPage + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={15} /></button>
                <button type="button" aria-label="Halaman terakhir" title="Halaman terakhir" disabled={currentItemsPage === itemsPageCount} onClick={() => setItemsPage(itemsPageCount)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronsRight size={15} /></button>
              </nav>
            </div>
          </div>}
        </section>
      </div>

      {selectedItemsReady && <>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">B</span><div><h3 className="text-sm font-semibold text-slate-900">Data Faktur Pajak</h3><p className="text-xs text-slate-500">Faktur ini mencakup {selectedItems.length} barang dari {selectedDocumentCount} nota. Satu faktur hanya dapat berasal dari satu pemasok.</p></div></div>
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Pemasok faktur</span><span className="ml-2 font-semibold text-slate-900">{supplier?.name || "—"}</span></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="NSFP" required><input className={inputClass} value={nsfp} onChange={(event) => setNsfp(event.target.value)} placeholder="Nomor seri faktur pajak" /></Field>
            <Field label="Tanggal faktur" required><input className={inputClass} type="date" value={invoiceDate} onChange={(event) => changeInvoiceDate(event.target.value)} /></Field>
            <Field label="Masa Pajak" required hint="Terisi otomatis dari tanggal faktur dan bisa disesuaikan."><div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2"><select className={inputClass} value={taxPeriodMonth} onChange={(event) => { setTaxPeriodMonth(event.target.value); setTaxPeriodTouched(true); }}><option value="">Pilih bulan</option>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{monthText(month)}</option>)}</select><input className={inputClass} aria-label="Tahun Masa Pajak" type="number" min="1900" max="9999" step="1" value={taxPeriodYear} onChange={(event) => { setTaxPeriodYear(event.target.value); setTaxPeriodTouched(true); }} placeholder="Tahun" /></div></Field>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-4 border-t border-slate-100 pt-3 text-sm"><span className="text-slate-500">DPP <strong className="ml-1 text-slate-800">{money(dppValue)}</strong></span><span className="text-slate-500">PPN <strong className="ml-1 text-slate-800">{money(ppnValue)}</strong></span>{otherTaxValue > 0 && <span className="text-slate-500">Pajak lain <strong className="ml-1 text-slate-800">{money(otherTaxValue)}</strong></span>}<span className="text-slate-500">Total <strong className="ml-1 text-slate-900">{money(invoiceTotal)}</strong></span></div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">C</span><div><h3 className="text-sm font-semibold text-slate-900">File faktur pajak</h3><p className="text-xs text-slate-500">Opsional. Unggah file PDF atau foto sekarang atau bisa diunggah nanti.</p></div></div>
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-4 py-4 text-center transition hover:bg-blue-50"><FileUp size={20} className="mb-1 text-blue-700" /><span className="text-sm font-semibold text-slate-800">{invoiceFile ? "Ganti file pilihan sebelum disimpan" : "Pilih PDF atau gambar faktur pajak (opsional)"}</span><span className="mt-1 text-xs text-slate-500">PDF, JPG, atau PNG · maksimal 15 MB · satu file</span><input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => { const file = event.target.files?.[0]; setInvoiceFile(file ? { file, selectedAt: new Date().toISOString() } : null); event.currentTarget.value = ""; }} /></label>
          {replacementInvoiceId && <div className="mt-4"><Field label="Alasan faktur pengganti" required hint="Catat alasan supplier menerbitkan NSFP pengganti agar jelas di riwayat versi."><textarea className={`${inputClass} min-h-20`} rows={3} maxLength={500} value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} placeholder="Contoh: supplier membatalkan faktur lama karena tanggal faktur salah, lalu menerbitkan NSFP pengganti." /></Field></div>}
          {invoiceFile && <div className="mt-5 border-t border-slate-100 pt-4"><div className="mb-3"><h4 className="text-sm font-semibold text-slate-900">File yang akan diunggah</h4><p className="mt-0.5 text-xs text-slate-500">File ini akan menjadi versi V{pendingVersionNumber} setelah faktur disimpan.{replacementInvoiceId ? " Riwayat versi dari faktur lama tetap dibawa." : " Versi pertama dicatat sebagai Unggahan awal."}</p></div><ol><li className="relative flex gap-3"><div className="relative flex w-8 shrink-0 justify-center"><span aria-hidden="true" className="absolute left-1/2 top-8 h-5 w-px -translate-x-1/2 bg-slate-200" /><span className="relative z-10 grid h-8 w-8 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700"><FileText size={15} /></span></div><div className="min-w-0 flex-1 py-0.5"><p className="text-sm font-semibold text-slate-900">{nsfp.trim() || "Nomor faktur"} - V{pendingVersionNumber}<span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Versi terbaru</span></p><p className="text-xs text-slate-500">{dateTimeText(invoiceFile.selectedAt)} · Oleh {userName} · Menunggu disimpan</p><p className="mt-0.5 text-xs text-slate-600">{invoiceFile.file.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || "File"} · {invoiceFile.file.size >= 1024 * 1024 ? `${(invoiceFile.file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(invoiceFile.file.size / 1024))} KB`}</p>{replacementReason.trim() && <p className="mt-1 text-xs leading-relaxed text-slate-700"><span className="font-semibold">Alasan versi:</span> {replacementReason.trim()}</p>}</div></li></ol></div>}
        </section>
      </>}

      <div className="flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center"><p className="text-xs text-slate-500">{selectedItems.length} barang dipilih{selectedItems.length > 0 ? ` dari ${selectedDocumentCount} nota · ${supplier?.name}` : ` · ${availableItems.length} barang tersedia`}</p><div className="flex justify-end gap-2"><Button variant="secondary" disabled={saving} onClick={onBack}>Kembali</Button><span title={canSave ? undefined : "Pilih barang, isi NSFP, tanggal dan Masa Pajak untuk menyimpan."}><Button loading={saving} disabled={!canSave} onClick={save}>{saving ? "Menyimpan faktur…" : replacementInvoiceId ? "Simpan faktur pengganti" : "Simpan faktur pajak"}</Button></span></div></div>
    </div>
  </div>;
}
