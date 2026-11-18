import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, Ban, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, Download, Eye, FileUp, FolderKanban, LoaderCircle, Pencil, Plus, ReceiptText, RotateCcw, Search, ShoppingBag, Table2, Rows3, Trash2, X } from "lucide-react";
import { api, dateText, dateTimeText, downloadFile, jsonBody, money, quantityText } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { InvoiceAttachment, PageResult, Project, PurchaseDocument, PurchaseItem, Supplier, User } from "../types";
import { confirmAction } from "../lib/swal";
import { Button, EmptyState, ErrorBanner, Field, inputClass as sharedInputClass, LoadingState, Modal, SectionHeading, StatusBadge, SummaryCards } from "./common";
import { SearchableSelect } from "./SearchableSelect";

type Props = {
  user: User;
  notify: (message: string, kind?: "success" | "error") => void;
  navHighlight?: { q?: string; highlightId?: string } | null;
  onClearNavHighlight?: () => void;
};
const inputClass = sharedInputClass.replace("rounded-xl", "rounded-lg");
type PurchaseEditorRoute = { mode: "new" } | { mode: "edit"; id: string } | null;
type AttachmentPreview = Pick<InvoiceAttachment, "id" | "original_filename" | "mime_type"> & Partial<Pick<InvoiceAttachment, "nsfp" | "invoice_date">> & { uploaded_at?: string; category?: string };
type PurchaseSourceAttachment = AttachmentPreview & { category: string; file_size: number; uploaded_at: string };
type ProjectPurchaseSummary = { project_id: string; project_name: string; document_count: number; item_count: number; purchase_total: number };
type PurchaseSummary = {
  purchase_documents_this_month: number;
  purchase_value_this_month: number;
  project_purchases_this_month: ProjectPurchaseSummary[];
  unassigned_purchase_this_month: Pick<ProjectPurchaseSummary, "document_count" | "item_count" | "purchase_total">;
  invoice_required_items_this_month: number;
  non_invoice_items_this_month: number;
  unclassified_items_this_month: number;
  total_items: number;
  items_requiring_invoice: number;
  missing_invoice_file_items: number;
};
type PriceTaxMode = "INCLUSIVE" | "EXCLUSIVE";
type ItemDraft = { project_id: string; item_name: string; item_description: string; quantity: string; uom: string; unit_price: string; invoice_requirement: "REQUIRED" | "NOT_REQUIRED"; item_notes: string };
const newItem = (invoiceRequirement: ItemDraft["invoice_requirement"] = "REQUIRED"): ItemDraft => ({ project_id: "", item_name: "", item_description: "", quantity: "1", uom: "Unit", unit_price: "0", invoice_requirement: invoiceRequirement, item_notes: "" });
const numeric = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;
const decimalInputValue = (value: string | number) => Number.isFinite(Number(value)) ? String(Number(value)) : "0";
const quantityInputValue = (value: string) => {
  const normalized = value.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [whole = "", ...fractionParts] = normalized.split(".");
  return fractionParts.length ? `${whole || "0"}.${fractionParts.join("").slice(0, 4)}` : whole;
};
const formatRupiahDraft = (value: string) => {
  if (!value) return "";
  const [whole = "0", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
};
const parseRupiahDraft = (value: string) => {
  if (!value) return "";
  const sanitized = value.replace(/[^\d,]/g, "");
  const comma = sanitized.indexOf(",");
  const integer = (comma < 0 ? sanitized : sanitized.slice(0, comma)).replace(/^0+(?=\d)/, "") || (sanitized ? "0" : "");
  if (comma < 0) return integer;
  const fraction = sanitized.slice(comma + 1).replace(/\D/g, "").slice(0, 4);
  return `${integer || "0"}.${fraction}`;
};
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;
const purchasePpnRate = 0.11;
function localDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function thisMonthDateRange() {
  const today = new Date();
  return {
    from: localDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}
const itemAmounts = (item: ItemDraft, mode: PriceTaxMode) => {
  const enteredPrice = roundMoney(numeric(item.unit_price));
  const isTaxable = item.invoice_requirement === "REQUIRED";
  const netUnitPrice = isTaxable && mode === "INCLUSIVE" ? enteredPrice / (1 + purchasePpnRate) : enteredPrice;
  const subtotal = roundMoney(numeric(item.quantity) * netUnitPrice);
  const total = !isTaxable || mode === "INCLUSIVE"
    ? roundMoney(numeric(item.quantity) * enteredPrice)
    : roundMoney(subtotal * (1 + purchasePpnRate));
  return { subtotal, tax: isTaxable ? roundMoney(total - subtotal) : 0, total };
};

function RupiahInput({ value, onChange, compact = false, ariaLabel }: { value: string; onChange: (value: string) => void; compact?: boolean; ariaLabel: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const caret = input.selectionStart ?? input.value.length;
    const prefix = input.value.slice(0, caret);
    const integerDigitsBefore = prefix.split(",")[0].replace(/\D/g, "").length;
    const hasDecimalBefore = prefix.includes(",");
    const fractionDigitsBefore = hasDecimalBefore ? prefix.slice(prefix.indexOf(",") + 1).replace(/\D/g, "").length : 0;
    const nextValue = parseRupiahDraft(input.value);
    const displayValue = formatRupiahDraft(nextValue);
    onChange(nextValue);
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node || document.activeElement !== node) return;
      const decimalPosition = displayValue.indexOf(",");
      const integerEnd = decimalPosition < 0 ? displayValue.length : decimalPosition;
      let position = 0;
      let digits = 0;
      while (position < integerEnd && digits < integerDigitsBefore) {
        if (/\d/.test(displayValue[position])) digits += 1;
        position += 1;
      }
      if (hasDecimalBefore && decimalPosition >= 0) {
        position = decimalPosition + 1;
        let fractionDigits = 0;
        while (position < displayValue.length && fractionDigits < fractionDigitsBefore) {
          if (/\d/.test(displayValue[position])) fractionDigits += 1;
          position += 1;
        }
      }
      node.setSelectionRange(position, position);
    });
  }
  return <div className="flex h-[42px] min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white transition focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100"><span className={`flex shrink-0 items-center border-r border-slate-200 bg-slate-50 font-medium text-slate-600 ${compact ? "px-1.5 text-[11px]" : "px-2 text-xs"}`}>Rp</span><input ref={inputRef} type="text" inputMode="decimal" autoComplete="off" className={`min-w-0 flex-1 bg-transparent text-right tabular-nums text-slate-900 outline-none ${compact ? "px-1.5 text-xs" : "px-3 text-sm"}`} value={formatRupiahDraft(value)} onChange={handleChange} aria-label={ariaLabel} /></div>;
}

function RupiahCalculatedInput({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  const isInt = Number.isInteger(value);
  const formatted = new Intl.NumberFormat("id-ID", { minimumFractionDigits: isInt ? 0 : 2, maximumFractionDigits: 4 }).format(value);
  return <div className="flex h-[42px] min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-slate-200"><span className="flex shrink-0 items-center border-r border-slate-300 bg-slate-300 px-2 text-xs font-medium text-slate-700">Rp</span><input className="min-w-0 flex-1 px-2 text-right text-xs font-medium tabular-nums text-slate-800 outline-none" style={{ backgroundColor: "#e2e8f0" }} value={formatted} readOnly aria-label={ariaLabel} /></div>;
}

function PriceTaxModeSwitch({ mode, onChange }: { mode: PriceTaxMode; onChange: (mode: PriceTaxMode) => void }) {
  const inclusive = mode === "INCLUSIVE";
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
    <div><p className="text-sm font-medium text-slate-800">Perhitungan PPN barang Faktur</p><p className="text-xs text-slate-500">Include: harga sudah termasuk PPN. Exclude: PPN ditambahkan ke harga. Barang Non-Faktur tidak dikenai PPN.</p></div>
    <div className="flex items-center gap-2.5" aria-label="Mode harga">
      <span className={`text-xs font-medium ${!inclusive ? "text-blue-700" : "text-slate-500"}`}>Exclude PPN</span>
      <button type="button" role="switch" aria-checked={inclusive} aria-label="Mode Include PPN" onClick={() => onChange(inclusive ? "EXCLUSIVE" : "INCLUSIVE")} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-blue-100 ${inclusive ? "bg-blue-600" : "bg-slate-300"}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${inclusive ? "translate-x-6" : "translate-x-1"}`} /></button>
      <span className={`text-xs font-medium ${inclusive ? "text-blue-700" : "text-slate-500"}`}>Include PPN</span>
    </div>
  </div>;
}

function purchaseEditorFromHash(): PurchaseEditorRoute {
  const [page, action, id] = window.location.hash.slice(1).split("/");
  if (page !== "purchases") return null;
  if (action === "new") return { mode: "new" };
  if (action === "edit" && id) return { mode: "edit", id: decodeURIComponent(id) };
  return null;
}

export function PurchasePage({ user, notify, navHighlight, onClearNavHighlight }: Props) {
  const defaultDateRange = useMemo(() => thisMonthDateRange(), []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [supplierId, setSupplierId] = useState("");
  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [invoiceFilter, setInvoiceFilter] = useState<"" | "REQUIRED" | "NOT_REQUIRED">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [view, setView] = useState<"grouped" | "flat">("flat");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [editorRoute, setEditorRoute] = useState<PurchaseEditorRoute>(purchaseEditorFromHash);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (navHighlight?.q) {
      setSearch(navHighlight.q);
    }
  }, [navHighlight?.q]);

  useEffect(() => {
    if (!navHighlight?.highlightId) return;
    const targetId = `row-${navHighlight.highlightId}`;
    const timer = setTimeout(() => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-4", "ring-amber-400", "bg-amber-100", "transition-all", "duration-500");
        const clearTimer = setTimeout(() => {
          el.classList.remove("ring-4", "ring-amber-400", "bg-amber-100");
          onClearNavHighlight?.();
        }, 4000);
        return () => clearTimeout(clearTimer);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [navHighlight?.highlightId, search]);
  const { data: summary, isLoading: summaryLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<PurchaseSummary>("/api/dashboard-summary") });
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (debouncedSearch) params.set("q", debouncedSearch);
  if (supplierId) params.set("supplierId", supplierId);
  if (dateRange.from) params.set("from", dateRange.from);
  if (dateRange.to) params.set("to", dateRange.to);
  if (invoiceFilter) params.set("invoiceRequirement", invoiceFilter);
  if (projectFilter) params.set("projectId", projectFilter);
  const { data, isLoading, error } = useQuery({ queryKey: ["purchases", page, pageSize, debouncedSearch, supplierId, dateRange.from, dateRange.to, invoiceFilter, projectFilter], queryFn: () => api<PageResult<PurchaseDocument>>(`/api/purchase-documents?${params}`) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/api/suppliers") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const editorId = editorRoute?.mode === "edit" ? editorRoute.id : "";
  const { data: editorDocument, isLoading: editorLoading, error: editorError } = useQuery({ queryKey: ["purchase-detail", editorId], queryFn: () => api<PurchaseDocument>(`/api/purchase-documents/${encodeURIComponent(editorId)}`), enabled: Boolean(editorId) });
  const canCreate = user.role === "PURCHASING" || user.role === "ADMIN";
  useEffect(() => {
    const syncEditor = () => setEditorRoute(purchaseEditorFromHash());
    window.addEventListener("popstate", syncEditor);
    window.addEventListener("hashchange", syncEditor);
    return () => { window.removeEventListener("popstate", syncEditor); window.removeEventListener("hashchange", syncEditor); };
  }, []);
  function openEditor(next: Exclude<PurchaseEditorRoute, null>) {
    const path = next.mode === "new" ? "#purchases/new" : `#purchases/edit/${encodeURIComponent(next.id)}`;
    window.history.pushState({ purchaseEditor: true }, "", path);
    setEditorRoute(next);
  }
  function closeEditor() {
    if (window.history.state?.purchaseEditor) {
      window.history.back();
      return;
    }
    window.history.replaceState({}, "", "#purchases");
    setEditorRoute(null);
  }

  const flatRows = useMemo(() => (data?.data || []).flatMap((doc) => doc.items.map((item) => ({ ...item, document: doc }))), [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const visiblePageCount = Math.min(5, totalPages);
  const firstVisiblePage = Math.min(Math.max(1, page - 2), Math.max(1, totalPages - visiblePageCount + 1));
  const visiblePages = Array.from({ length: visiblePageCount }, (_, index) => firstVisiblePage + index);
  const hasActiveFilters = Boolean(search.trim() || supplierId || invoiceFilter || projectFilter || dateRange.from !== defaultDateRange.from || dateRange.to !== defaultDateRange.to);
  const toggle = (id: string) => setOpenIds((previous) => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const projectTones = ["blue", "emerald", "violet", "amber"] as const;
  const projectCards = (summary?.project_purchases_this_month || []).map((project, index) => ({
    label: project.project_name,
    value: money(project.purchase_total),
    detail: `${project.document_count} dokumen · ${project.item_count} barang bulan ini`,
    loading: summaryLoading,
    icon: FolderKanban,
    tone: projectTones[index % projectTones.length],
  }));
  projectCards.push({
    label: "Tanpa project",
    value: money(summary?.unassigned_purchase_this_month?.purchase_total ?? 0),
    detail: `${summary?.unassigned_purchase_this_month?.document_count ?? 0} dokumen · ${summary?.unassigned_purchase_this_month?.item_count ?? 0} barang bulan ini`,
    loading: summaryLoading,
    icon: FolderKanban,
    tone: "amber",
  });
  const cards = [
    { label: "Pembelian bulan ini", value: money(summary?.purchase_value_this_month ?? 0), detail: `${summary?.purchase_documents_this_month ?? 0} dokumen pembelian`, loading: summaryLoading, icon: ShoppingBag, tone: "blue" as const },
    { label: "Belum ada faktur", value: summary?.missing_invoice_file_items ?? 0, unit: "barang", detail: `Dari ${summary?.items_requiring_invoice ?? 0} barang status Faktur · semua periode`, loading: summaryLoading, icon: CircleAlert, tone: "amber" as const },
    { label: "Barang Faktur bulan ini", value: summary?.invoice_required_items_this_month ?? 0, unit: "barang", detail: summary?.unclassified_items_this_month ? `${summary.unclassified_items_this_month} barang belum ditetapkan` : "Berstatus Faktur", loading: summaryLoading, icon: BadgeCheck, tone: "violet" as const },
    { label: "Barang Non faktur bulan ini", value: summary?.non_invoice_items_this_month ?? 0, unit: "barang", detail: "Berstatus Non faktur", loading: summaryLoading, icon: Ban, tone: "emerald" as const },
  ];

  if (editorRoute) {
    const backAction = <Button variant="secondary" onClick={closeEditor}><ArrowLeft size={16} />Kembali ke Pembelian</Button>;
    if (editorRoute.mode === "edit" && editorLoading) return <div><SectionHeading title="Edit Pembelian" description="Memuat data transaksi untuk diedit." action={backAction} /><LoadingState label="Mengambil detail pembelian…" /></div>;
    if (editorRoute.mode === "edit" && (editorError || !editorDocument)) return <div><SectionHeading title="Edit Pembelian" description="Detail transaksi tidak dapat dimuat." action={backAction} /><ErrorBanner message={editorError instanceof Error ? editorError.message : "Dokumen pembelian tidak ditemukan."} /></div>;
    return <PurchaseEditorPage key={editorRoute.mode === "edit" ? editorRoute.id : "new"} suppliers={suppliers} document={editorRoute.mode === "edit" ? editorDocument : undefined} onClose={closeEditor} notify={notify} onSaved={() => { closeEditor(); setPage(1); queryClient.invalidateQueries({ queryKey: ["purchases"] }); queryClient.invalidateQueries({ queryKey: ["invoice-source-notes"] }); queryClient.invalidateQueries({ queryKey: ["dashboard"] }); }} />;
  }

  return <div>
    <SectionHeading title="Kelola Pembelian" description="Catat transaksi pemasok, pantau kelengkapan faktur, dan telusuri barang dalam setiap pembelian." action={canCreate && <Button onClick={() => openEditor({ mode: "new" })}><Plus size={16} />Tambah Pembelian</Button>} />
    <SummaryCards cards={cards} columns={4} />
    <section className="mb-5">
      <div className="mb-2"><h3 className="text-sm font-semibold text-slate-800">Pembelian per project bulan ini</h3><p className="mt-0.5 text-xs text-slate-500">Nilai transaksi dan jumlah barang pada setiap project.</p></div>
      {summaryLoading ? <LoadingState label="Menghitung pembelian per project bulan ini…" compact /> : projectCards.length ? <SummaryCards cards={projectCards} autoFit /> : <div className="mb-5 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">Belum ada pembelian per project bulan ini.</div>}
    </section>
    <section className="mb-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-card">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className={`${inputClass} pl-9`} placeholder="Cari kode, supplier, dokumen, barang…" /></div>
        <div className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2" role="group" aria-label="Rentang tanggal pembelian">
          <label className="flex min-w-0 flex-col justify-center px-0.5">
            <span className="text-[9px] font-semibold uppercase leading-3 tracking-wide text-slate-400">Dari</span>
            <input type="date" aria-label="Tanggal mulai" title="Tanggal mulai" value={dateRange.from} max={dateRange.to || undefined} onChange={(event) => { setDateRange((range) => ({ ...range, from: event.target.value })); setPage(1); }} className="h-5 w-[116px] min-w-0 bg-transparent text-xs font-medium text-slate-700 outline-none" />
          </label>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-slate-200" />
          <label className="flex min-w-0 flex-col justify-center px-0.5">
            <span className="text-[9px] font-semibold uppercase leading-3 tracking-wide text-slate-400">Sampai</span>
            <input type="date" aria-label="Tanggal akhir" title="Tanggal akhir" value={dateRange.to} min={dateRange.from || undefined} onChange={(event) => { setDateRange((range) => ({ ...range, to: event.target.value })); setPage(1); }} className="h-5 w-[116px] min-w-0 bg-transparent text-xs font-medium text-slate-700 outline-none" />
          </label>
        </div>
        <SearchableSelect className={`${inputClass} lg:w-[220px]`} value={supplierId} placeholder="Semua supplier" searchPlaceholder="Cari supplier…" options={suppliers.map((s) => ({ value: s.id, label: s.name, sublabel: s.supplier_code }))} onChange={(value) => { setSupplierId(value); setPage(1); }} />
        <div className="inline-flex w-fit shrink-0 items-center rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setView("grouped")} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${view === "grouped" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><Rows3 size={15} />Grouped</button>
          <button type="button" onClick={() => setView("flat")} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${view === "flat" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><Table2 size={15} />Per barang</button>
        </div>
      </div>
      <div className="flex max-w-full items-center gap-2 overflow-x-auto border-t border-slate-100 pt-2 pb-0.5">
        <span className="shrink-0 text-xs font-semibold text-slate-500">Filter Faktur</span>
        <div role="group" aria-label="Filter jenis faktur" className="flex shrink-0 gap-1">
          {[
            { value: "", label: "Semua barang", count: summary?.total_items },
            { value: "REQUIRED", label: "Faktur", count: summary?.items_requiring_invoice },
            { value: "NOT_REQUIRED", label: "Non faktur", count: summary ? (summary.total_items - summary.items_requiring_invoice) : undefined },
          ].map((tab) => {
            const active = invoiceFilter === tab.value;
            return (
              <button
                key={tab.value || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => { setInvoiceFilter(tab.value as any); setPage(1); setOpenIds(new Set()); }}
                className={`inline-flex items-center gap-1.5 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-blue-700 text-white shadow-sm" : "text-blue-800 hover:bg-blue-50"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    active ? "bg-white/25 text-white" : "bg-blue-100 text-blue-800"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span aria-hidden="true" className="shrink-0 px-1 text-slate-300">|</span>
        <span className="shrink-0 text-xs font-semibold text-slate-500">Filter Project</span>
        <div role="group" aria-label="Filter project" className="flex shrink-0 gap-1">
          {[
            { value: "", label: "Semua project", count: summary?.total_items },
            ...projects.map((project) => ({
              value: project.id,
              label: project.name,
              count: summary?.project_purchases_this_month.find((p) => p.project_id === project.id)?.item_count ?? 0,
            })),
            { value: "none", label: "Tanpa project", count: summary?.unassigned_purchase_this_month?.item_count ?? 0 },
          ].map((tab) => {
            const active = projectFilter === tab.value;
            return (
              <button
                key={tab.value || "all-projects"}
                type="button"
                aria-pressed={active}
                onClick={() => { setProjectFilter(tab.value); setPage(1); setOpenIds(new Set()); }}
                className={`inline-flex items-center gap-1.5 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-blue-700 text-white shadow-sm" : "text-blue-800 hover:bg-blue-50"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    active ? "bg-white/25 text-white" : "bg-blue-100 text-blue-800"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" disabled={!hasActiveFilters} onClick={() => { setSearch(""); setSupplierId(""); setDateRange(defaultDateRange); setInvoiceFilter(""); setProjectFilter(""); setPage(1); setOpenIds(new Set()); }} className="ml-auto inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={13} />Reset semua filter</button>
      </div>
    </section>
    <ErrorBanner message={error instanceof Error ? error.message : null} />
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      {isLoading ? <LoadingState label="Mengambil daftar pembelian…" /> : !data?.data.length ? <div className="p-5"><EmptyState title="Belum ada dokumen pembelian" description="Tambahkan transaksi pertama untuk mulai mencatat barang dan kebutuhan faktur." /></div> : view === "grouped" ? <div className="overflow-x-auto"><table className="w-full min-w-[1000px] whitespace-nowrap text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="w-10 px-4 py-2.5"></th><th className="px-4 py-2.5">Kode kelompok / tanggal</th><th className="px-4 py-2.5">Supplier</th><th className="px-4 py-2.5">No. nota pembelian</th><th className="px-4 py-2.5 text-center">Jumlah barang</th><th className="px-4 py-2.5 text-right">Total</th><th className="px-4 py-2.5">Faktur terunggah</th><th className="px-4 py-2.5">Aksi</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.data.map((doc) => <PurchaseGroupRow key={doc.id} doc={doc} expanded={openIds.has(doc.id)} toggle={() => toggle(doc.id)} user={user} onEdit={() => openEditor({ mode: "edit", id: doc.id })} notify={notify} onUpload={async (file, category = "PURCHASE_SOURCE") => { const form = new FormData(); form.append("file", file); form.append("owner_type", "PURCHASE"); form.append("owner_id", doc.id); form.append("category", category); try { await api("/api/attachments", { method: "POST", body: form }); queryClient.invalidateQueries({ queryKey: ["purchase-files", doc.id] }); notify(category === "PAYMENT_PROOF" ? "Bukti transfer berhasil diunggah." : "Nota pembelian berhasil diunggah.", "success"); } catch (e: any) { notify(e.message, "error"); } }} />)}</tbody>
      </table></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1350px] whitespace-nowrap text-left text-sm">
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-2.5">Tanggal</th><th className="px-4 py-2.5">Supplier</th><th className="px-4 py-2.5">Project</th><th className="px-4 py-2.5">Nama barang</th><th className="px-4 py-2.5 text-right">Qty</th><th className="px-4 py-2.5">UOM</th><th className="px-4 py-2.5 text-right">Sub Total</th><th className="px-4 py-2.5 text-right">PPN</th><th className="px-4 py-2.5 text-right">Total</th><th className="px-4 py-2.5">Tanggal faktur</th><th className="px-4 py-2.5">Faktur</th><th className="px-4 py-2.5">Aksi</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{flatRows.map(({ document, ...item }) => <PurchaseItemRow key={item.id} document={document} item={item} user={user} notify={notify} onEdit={() => openEditor({ mode: "edit", id: document.id })} />)}</tbody>
      </table></div>}
    </section>
    <footer aria-label="Pagination pembelian" className="mt-3 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>Menampilkan <strong className="font-semibold text-slate-800">{firstItem} - {lastItem}</strong> dari <strong className="font-semibold text-slate-800">{total}</strong> data</span>
        <span className="hidden h-6 border-l border-slate-200 sm:block" aria-hidden="true" />
        <label className="flex items-center gap-2 text-xs text-slate-500">Per hal:
          <select aria-label="Jumlah data per halaman" className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {[15, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      <nav aria-label="Navigasi halaman" className="flex flex-wrap items-center gap-1 sm:justify-end">
        <button type="button" aria-label="Halaman pertama" disabled={page <= 1} onClick={() => setPage(1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"><ChevronsLeft size={15} /></button>
        <button type="button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={15} /></button>
        {visiblePages.map((pageNumber) => <button key={pageNumber} type="button" aria-label={`Halaman ${pageNumber}`} aria-current={pageNumber === page ? "page" : undefined} onClick={() => setPage(pageNumber)} className={`grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-sm font-medium transition ${pageNumber === page ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{pageNumber}</button>)}
        <button type="button" aria-label="Halaman berikutnya" disabled={!data || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={15} /></button>
        <button type="button" aria-label="Halaman terakhir" disabled={!data || page >= totalPages} onClick={() => setPage(totalPages)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"><ChevronsRight size={15} /></button>
      </nav>
    </footer>
  </div>;
}

function PurchaseItemRow({ document, item, user, onEdit, notify }: { document: PurchaseDocument; item: PurchaseItem; user: User; onEdit: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ title: string; files: AttachmentPreview[]; selectedId: string } | null>(null);
  const canPreviewInvoices = user.role === "TAX_STAFF" || user.role === "ADMIN";
  const { data: purchaseFiles = [] } = useQuery({
    queryKey: ["purchase-files", document.id],
    queryFn: () => api<PurchaseSourceAttachment[]>(`/api/attachments/purchase/${document.id}`),
  });
  const noteFiles = purchaseFiles.filter((f) => f.category === "PURCHASE_SOURCE" || (!f.category || f.category !== "PAYMENT_PROOF"));
  const transferFiles = purchaseFiles.filter((f) => f.category === "PAYMENT_PROOF");
  const invoiceFiles = item.invoice_attachments || [];
  const latestInvoice = invoiceFiles[0];
  const openPreview = (title: string, files: AttachmentPreview[]) => {
    if (files.length) setPreview({ title, files, selectedId: files[0].id });
  };
  const selectedFile = preview?.files.find((file) => file.id === preview.selectedId);

  async function handleDeleteFile(file: AttachmentPreview) {
    if (!(await confirmAction({ title: `Hapus ${file.original_filename}?`, text: "File akan dihapus permanen dari sistem.", confirmButtonText: "Ya, Hapus", danger: true }))) return;
    try {
      await api(`/api/attachments/${file.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["purchase-files", document.id] });
      notify("File berhasil dihapus.", "success");
      setPreview(null);
    } catch (e: any) { notify(e.message, "error"); }
  }

  return <>
    <tr id={`row-item-${item.id}`} className="hover:bg-slate-50/70">
      <td className="px-4 py-2 text-slate-700">{dateText(document.purchase_date)}</td>
      <td className="px-4 py-2 text-slate-700">{document.supplier_name}</td>
      <td className="px-4 py-2 text-slate-700">{item.project_name || "—"}</td>
      <td className="px-4 py-2 font-medium text-slate-800">{item.item_name}</td>
      <td className="px-4 py-2 text-right tabular-nums">{quantityText(item.quantity)}</td>
      <td className="px-4 py-2">{item.uom}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(item.purchase_subtotal)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(item.purchase_tax_amount)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(item.purchase_total ?? Number(item.purchase_subtotal) + Number(item.purchase_tax_amount || 0))}</td>
      <td className="px-4 py-2 text-slate-700">{latestInvoice ? dateText(latestInvoice.invoice_date) : Boolean(item.has_uploaded_invoice) && !canPreviewInvoices ? <span className="text-xs text-slate-400">Akses terbatas</span> : "—"}</td>
      <td className="px-4 py-2"><StatusBadge value={item.invoice_requirement} /></td>
      <td className="px-4 py-2"><div className="flex items-center gap-2">
        {(user.role === "PURCHASING" || user.role === "ADMIN") && <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" title={`Edit pembelian ${document.purchase_group_code}`} onClick={onEdit}><Pencil size={13} />Edit</Button>}
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={!noteFiles.length} title={noteFiles.length ? "Buka nota pembelian" : "Nota pembelian belum diunggah"} onClick={() => openPreview("Nota pembelian", noteFiles)}><Eye size={13} />Nota</Button>
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={!transferFiles.length} title={transferFiles.length ? "Buka bukti transfer" : "Bukti transfer belum diunggah"} onClick={() => openPreview("Bukti transfer", transferFiles)}><Eye size={13} />Transfer</Button>
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={item.invoice_requirement === "NOT_REQUIRED" || !invoiceFiles.length || !canPreviewInvoices} title={item.invoice_requirement === "NOT_REQUIRED" ? "Barang ini ditandai non faktur" : !invoiceFiles.length ? "File faktur belum tersedia" : canPreviewInvoices ? "Buka file faktur" : "Pratinjau faktur hanya tersedia untuk Staff Pajak dan Admin"} onClick={() => openPreview("Faktur pajak", invoiceFiles)}><Eye size={13} />Faktur{invoiceFiles.length > 1 ? ` (${invoiceFiles.length})` : ""}</Button>
      </div></td>
    </tr>
    {preview && selectedFile && <Modal title={preview.title} subtitle={selectedFile.nsfp ? `${selectedFile.nsfp} · ${dateText(selectedFile.invoice_date)}` : selectedFile.uploaded_at ? `Diunggah ${dateTimeText(selectedFile.uploaded_at)} · ${selectedFile.original_filename}` : selectedFile.original_filename} onClose={() => setPreview(null)} size="max-w-5xl">
      <div className="h-[65vh] min-h-[300px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">{selectedFile.mime_type === "application/pdf" ? <iframe title={`Preview ${preview.title.toLowerCase()}`} src={`/api/attachments/${selectedFile.id}/preview`} className="h-full w-full border-0" /> : <img src={`/api/attachments/${selectedFile.id}/preview`} alt={`Preview ${preview.title.toLowerCase()}`} className="h-full w-full object-contain" />}</div>
      <div className="mt-3 flex items-center justify-between">
        <div>
          {(user.role === "PURCHASING" || user.role === "ADMIN") && !selectedFile.nsfp && (
            <Button type="button" variant="dangerGhost" className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50" onClick={() => void handleDeleteFile(selectedFile)}>
              <Trash2 size={13} />Hapus file
            </Button>
          )}
        </div>
        <Button type="button" variant="secondary" onClick={() => downloadFile(`/api/attachments/${selectedFile.id}/download`, selectedFile.original_filename)}><Download size={14} />Unduh file</Button>
      </div>
    </Modal>}
  </>;
}

function PurchaseGroupRow({ doc, expanded, toggle, user, onUpload, onEdit, notify }: { doc: PurchaseDocument; expanded: boolean; toggle: () => void; user: User; onUpload: (file: File, category: "PURCHASE_SOURCE" | "PAYMENT_PROOF") => Promise<void>; onEdit: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const queryClient = useQueryClient();
  const [uploadingNote, setUploadingNote] = useState(false);
  const [uploadingTransfer, setUploadingTransfer] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentPreview | null>(null);
  const canPreviewInvoices = user.role === "TAX_STAFF" || user.role === "ADMIN";
  const canUploadPurchaseNote = user.role === "PURCHASING" || user.role === "ADMIN";
  const { data: files = [] } = useQuery({ queryKey: ["purchase-files", doc.id], queryFn: () => api<PurchaseSourceAttachment[]>(`/api/attachments/purchase/${doc.id}`) });
  const noteFiles = files.filter((f) => f.category === "PURCHASE_SOURCE" || (!f.category || f.category !== "PAYMENT_PROOF"));
  const transferFiles = files.filter((f) => f.category === "PAYMENT_PROOF");
  const invoiceRequiredItems = doc.items.filter((item) => item.invoice_requirement !== "NOT_REQUIRED");
  const uploadedInvoiceItems = invoiceRequiredItems.filter((item) => Boolean(item.has_uploaded_invoice)).length;
  const invoiceProgress = invoiceRequiredItems.length ? uploadedInvoiceItems / invoiceRequiredItems.length : 0;
  const allInvoicesUploaded = invoiceRequiredItems.length > 0 && uploadedInvoiceItems === invoiceRequiredItems.length;

  async function handleDeleteAttachment(file: AttachmentPreview) {
    if (!(await confirmAction({ title: `Hapus ${file.original_filename}?`, text: "File akan dihapus permanen.", confirmButtonText: "Ya, Hapus", danger: true }))) return;
    try {
      await api(`/api/attachments/${file.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["purchase-files", doc.id] });
      notify("File berhasil dihapus.", "success");
      if (previewAttachment?.id === file.id) setPreviewAttachment(null);
    } catch (e: any) { notify(e.message, "error"); }
  }

  return <>
    <tr id={`row-doc-${doc.id}`} tabIndex={0} aria-expanded={expanded} onClick={toggle} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }} className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${expanded ? "bg-slate-50/80" : "hover:bg-slate-50/70"}`}>
      <td className="px-4 py-2"><button onClick={(event) => { event.stopPropagation(); toggle(); }} aria-label={expanded ? "Ciutkan" : "Buka detail"} aria-expanded={expanded} className={`rounded-lg border p-1.5 transition ${expanded ? "border-slate-300 bg-white text-slate-700 shadow-sm" : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-800"}`}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></td>
      <td className="px-4 py-2"><span className="font-semibold text-slate-900">{doc.purchase_group_code}</span><span className="mt-0.5 block text-xs text-slate-600">{dateText(doc.purchase_date)}</span></td>
      <td className="px-4 py-2 font-medium text-slate-800">{doc.supplier_name}</td><td className="px-4 py-2 text-slate-700">{doc.supplier_document_no || "—"}</td>
      <td className="px-4 py-2 text-center tabular-nums">{doc.item_count} barang</td><td className="px-4 py-2 text-right font-medium tabular-nums">{money(doc.total_amount)}</td>
      <td className="min-w-[160px] px-4 py-2">{invoiceRequiredItems.length ? <div className="min-w-[132px]" title={`${uploadedInvoiceItems} dari ${invoiceRequiredItems.length} barang yang memerlukan faktur sudah memiliki PDF faktur`}><span className={`text-xs font-semibold tabular-nums ${allInvoicesUploaded ? "text-emerald-700" : uploadedInvoiceItems ? "text-blue-700" : "text-amber-700"}`}>{uploadedInvoiceItems} dari {invoiceRequiredItems.length} barang</span><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-[width] ${allInvoicesUploaded ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${invoiceProgress * 100}%` }} /></div></div> : <span className="text-slate-400">—</span>}</td>
      <td className="px-4 py-2" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2">
          {(user.role === "PURCHASING" || user.role === "ADMIN") && <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={onEdit}><Pencil size={13} />Edit</Button>}
          <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" disabled={!noteFiles.length} title={noteFiles.length ? "Buka nota pembelian" : "Nota pembelian belum diunggah"} onClick={() => { if (noteFiles.length) setPreviewAttachment(noteFiles[0]); }}><Eye size={13} />Nota</Button>
          <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" disabled={!transferFiles.length} title={transferFiles.length ? "Buka bukti transfer" : "Bukti transfer belum diunggah"} onClick={() => { if (transferFiles.length) setPreviewAttachment(transferFiles[0]); }}><Eye size={13} />Transfer</Button>
        </div>
      </td>
    </tr>
    {expanded && <tr className="bg-slate-50/60"><td colSpan={8} className="px-4 pb-4 pt-2"><div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="text-xs font-semibold text-slate-700">Lampiran & Barang dalam pembelian #{doc.purchase_group_code}</div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Slot Nota */}
          {noteFiles.length > 0 ? (
            <div className="flex items-center gap-1 rounded-xl border border-blue-200 bg-white p-1">
              <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Nota</span>
              <span title={noteFiles[0].original_filename} className="max-w-36 truncate px-1 text-xs text-slate-600">{noteFiles[0].original_filename}</span>
              <Button variant="secondary" className="px-2 py-1 text-xs" title={`Preview ${noteFiles[0].original_filename}`} onClick={() => setPreviewAttachment(noteFiles[0])}><Eye size={13} />Preview</Button>
              <Button variant="secondary" className="px-2 py-1 text-xs" title={`Unduh ${noteFiles[0].original_filename}`} onClick={() => downloadFile(`/api/attachments/${noteFiles[0].id}/download`, noteFiles[0].original_filename)}><Download size={13} />Unduh</Button>
              {canUploadPurchaseNote && <>
                <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50" title="Ganti/replace file nota">
                  Ganti
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) { setUploadingNote(true); try { await onUpload(file, "PURCHASE_SOURCE"); } finally { setUploadingNote(false); } }
                    e.currentTarget.value = "";
                  }} />
                </label>
                <Button variant="dangerGhost" className="px-1.5 py-1 text-xs text-rose-600 hover:bg-rose-50" title="Hapus nota" onClick={() => void handleDeleteAttachment(noteFiles[0])}><Trash2 size={13} /></Button>
              </>}
            </div>
          ) : canUploadPurchaseNote ? (
            <label className={`inline-flex items-center gap-1.5 rounded-xl border border-dashed border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition ${uploadingNote ? "pointer-events-none opacity-60" : "cursor-pointer hover:bg-blue-50"}`}>
              {uploadingNote ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <FileUp size={14} />}
              {uploadingNote ? "Mengunggah…" : "Unggah nota"}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingNote} className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) { setUploadingNote(true); try { await onUpload(file, "PURCHASE_SOURCE"); } finally { setUploadingNote(false); } }
                e.currentTarget.value = "";
              }} />
            </label>
          ) : null}

          {/* Slot Transfer */}
          {transferFiles.length > 0 ? (
            <div className="flex items-center gap-1 rounded-xl border border-emerald-200 bg-white p-1">
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Transfer</span>
              <span title={transferFiles[0].original_filename} className="max-w-36 truncate px-1 text-xs text-slate-600">{transferFiles[0].original_filename}</span>
              <Button variant="secondary" className="px-2 py-1 text-xs" title={`Preview ${transferFiles[0].original_filename}`} onClick={() => setPreviewAttachment(transferFiles[0])}><Eye size={13} />Preview</Button>
              <Button variant="secondary" className="px-2 py-1 text-xs" title={`Unduh ${transferFiles[0].original_filename}`} onClick={() => downloadFile(`/api/attachments/${transferFiles[0].id}/download`, transferFiles[0].original_filename)}><Download size={13} />Unduh</Button>
              {canUploadPurchaseNote && <>
                <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50" title="Ganti/replace bukti transfer">
                  Ganti
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) { setUploadingTransfer(true); try { await onUpload(file, "PAYMENT_PROOF"); } finally { setUploadingTransfer(false); } }
                    e.currentTarget.value = "";
                  }} />
                </label>
                <Button variant="dangerGhost" className="px-1.5 py-1 text-xs text-rose-600 hover:bg-rose-50" title="Hapus bukti transfer" onClick={() => void handleDeleteAttachment(transferFiles[0])}><Trash2 size={13} /></Button>
              </>}
            </div>
          ) : canUploadPurchaseNote ? (
            <label className={`inline-flex items-center gap-1.5 rounded-xl border border-dashed border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition ${uploadingTransfer ? "pointer-events-none opacity-60" : "cursor-pointer hover:bg-emerald-50"}`}>
              {uploadingTransfer ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <FileUp size={14} />}
              {uploadingTransfer ? "Mengunggah…" : "Unggah transfer"}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingTransfer} className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) { setUploadingTransfer(true); try { await onUpload(file, "PAYMENT_PROOF"); } finally { setUploadingTransfer(false); } }
                e.currentTarget.value = "";
              }} />
            </label>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full min-w-[1180px] whitespace-nowrap text-left text-xs"><thead className="bg-slate-100 uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-2.5">Kode item</th><th className="px-3 py-2.5">Project</th><th className="px-3 py-2.5">Nama barang</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5">UOM</th><th className="px-3 py-2.5 text-right">Sub Total</th><th className="px-3 py-2.5 text-right">PPN</th><th className="px-3 py-2.5 text-right">Total</th><th className="px-3 py-2.5">Faktur</th><th className="px-3 py-2.5">Tanggal faktur</th><th className="px-3 py-2.5">Preview faktur</th></tr></thead><tbody className="divide-y divide-slate-100">{doc.items.map((item) => { const attachments = item.invoice_attachments || []; const latestInvoice = attachments[0]; const emptyLabel = item.invoice_requirement === "NOT_REQUIRED" ? "Non faktur" : !canPreviewInvoices && item.has_uploaded_invoice ? "Akses terbatas" : "Belum diunggah"; return <tr key={item.id} id={`row-item-${item.id}`} className="odd:bg-white even:bg-slate-50/60 hover:bg-slate-100/70"><td className="px-3 py-2.5 font-medium text-blue-700">{item.item_code}</td><td className="px-3 py-2.5 text-slate-700">{item.project_name || "Tanpa project"}</td><td className="px-3 py-2.5 font-medium text-slate-900">{item.item_name}</td><td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{quantityText(item.quantity)}</td><td className="px-3 py-2.5 text-slate-800">{item.uom}</td><td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">{money(item.purchase_subtotal)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(item.purchase_tax_amount)}</td><td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">{money(item.purchase_total ?? Number(item.purchase_subtotal) + Number(item.purchase_tax_amount || 0))}</td><td className="px-3 py-2.5"><StatusBadge value={item.invoice_requirement} /></td><td className="px-3 py-2.5 text-slate-600">{latestInvoice ? dateText(latestInvoice.invoice_date) : !canPreviewInvoices && item.has_uploaded_invoice ? "Akses terbatas" : "—"}</td><td className="px-3 py-2.5">{canPreviewInvoices && attachments.length ? <div className="flex flex-wrap gap-1.5">{attachments.map((attachment, index) => <button key={attachment.id} type="button" aria-label={`Preview faktur ${attachment.nsfp}`} title={`${attachment.nsfp} · ${attachment.original_filename}`} onClick={() => setPreviewAttachment(attachment)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"><Eye size={13} />{attachments.length > 1 ? `Preview ${index + 1}` : "Preview"}</button>)}</div> : <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs italic text-slate-500">{emptyLabel}</span>}</td></tr>; })}</tbody></table></div>
    </div></td></tr>}
    {previewAttachment && createPortal(<Modal title={previewAttachment.category === "PAYMENT_PROOF" ? "Bukti transfer" : previewAttachment.nsfp ? `Faktur ${previewAttachment.nsfp}` : "Nota pembelian"} subtitle={previewAttachment.nsfp ? `${previewAttachment.nsfp} · ${dateText(previewAttachment.invoice_date)}` : previewAttachment.uploaded_at ? `Diunggah ${dateTimeText(previewAttachment.uploaded_at)} · ${previewAttachment.original_filename}` : previewAttachment.original_filename} onClose={() => setPreviewAttachment(null)} size="max-w-5xl">
      <div className="h-[65vh] min-h-[300px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">{previewAttachment.mime_type === "application/pdf" ? <iframe title={`Preview ${previewAttachment.nsfp ? `faktur ${previewAttachment.nsfp}` : "lampiran"}`} src={`/api/attachments/${previewAttachment.id}/preview`} className="h-full w-full border-0" /> : <img src={`/api/attachments/${previewAttachment.id}/preview`} alt={`Preview ${previewAttachment.nsfp ? `faktur ${previewAttachment.nsfp}` : "lampiran"}`} className="h-full w-full object-contain" />}</div>
      <div className="mt-3 flex items-center justify-between">
        <div>
          {canUploadPurchaseNote && !previewAttachment.nsfp && (
            <Button type="button" variant="dangerGhost" className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50" onClick={() => void handleDeleteAttachment(previewAttachment)}>
              <Trash2 size={13} />Hapus file
            </Button>
          )}
        </div>
        <Button variant="secondary" onClick={() => downloadFile(`/api/attachments/${previewAttachment.id}/download`, previewAttachment.original_filename)}><Download size={14} />Unduh file</Button>
      </div>
    </Modal>, document.body)}
  </>;
}

function PurchaseEditorPage({ suppliers, document, onClose, onSaved, notify }: { suppliers: Supplier[]; document?: PurchaseDocument; onClose: () => void; onSaved: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const [supplierId, setSupplierId] = useState(document?.supplier_id || "");
  const [purchaseDate, setPurchaseDate] = useState(document?.purchase_date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [supplierDocumentNo, setSupplierDocumentNo] = useState(document?.supplier_document_no || "");
  const [notes, setNotes] = useState(document?.notes || "");
  const initialPriceTaxMode: PriceTaxMode = document?.price_tax_mode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE";
  const [priceTaxMode, setPriceTaxMode] = useState<PriceTaxMode>(initialPriceTaxMode);
  const [items, setItems] = useState<ItemDraft[]>(document?.items.map((item) => ({
    project_id: item.project_id || "", item_name: item.item_name, item_description: item.item_description || "",
    quantity: decimalInputValue(item.quantity), uom: item.uom,
    unit_price: decimalInputValue(item.unit_price_entered ?? (initialPriceTaxMode === "INCLUSIVE" ? roundMoney(Number(item.unit_price) * (1 + purchasePpnRate)) : item.unit_price)),
    invoice_requirement: item.invoice_requirement === "NOT_REQUIRED" ? "NOT_REQUIRED" : "REQUIRED",
    item_notes: item.item_notes || "",
  })) || [newItem()]);
  const supplierDefaultInvoiceRequirement = suppliers.find((supplier) => supplier.id === supplierId)?.default_invoice_requirement === "NOT_REQUIRED" ? "NOT_REQUIRED" : "REQUIRED";
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const { data: existingFiles = [] } = useQuery({
    queryKey: ["purchase-files", document?.id],
    queryFn: () => api<PurchaseSourceAttachment[]>(`/api/attachments/purchase/${document?.id}`),
    enabled: Boolean(document?.id),
  });
  const existingNotes = existingFiles.filter((f) => f.category === "PURCHASE_SOURCE" || (!f.category || f.category !== "PAYMENT_PROOF"));
  const existingTransfers = existingFiles.filter((f) => f.category === "PAYMENT_PROOF");
  const [error, setError] = useState("");

  async function deleteExistingFile(file: AttachmentPreview) {
    if (!(await confirmAction({ title: `Hapus ${file.original_filename}?`, text: "File akan dihapus permanen.", confirmButtonText: "Ya, Hapus", danger: true }))) return;
    try {
      await api(`/api/attachments/${file.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["purchase-files", document?.id] });
      notify("File berhasil dihapus.", "success");
    } catch (e: any) { notify(e.message, "error"); }
  }
  const [saving, setSaving] = useState(false);
  const subtotal = roundMoney(items.reduce((sum, item) => sum + itemAmounts(item, priceTaxMode).subtotal, 0));
  const taxSum = roundMoney(items.reduce((sum, item) => sum + itemAmounts(item, priceTaxMode).tax, 0));
  const total = roundMoney(items.reduce((sum, item) => sum + itemAmounts(item, priceTaxMode).total, 0));
  const canSave = Boolean(supplierId) && items.length > 0 && items.every((item) =>
    item.item_name.trim() && item.uom.trim() && numeric(item.quantity) > 0 && item.unit_price.trim() !== "" && Number.isFinite(Number(item.unit_price)) && Number(item.unit_price) >= 0
  );
  const saveDisabledHint = "Isi supplier, nama barang, Qty, UOM, dan Harga yang valid untuk mengaktifkan tombol simpan.";
  function updateItem<K extends keyof ItemDraft>(index: number, key: K, value: ItemDraft[K]) {
    setItems((rows) => rows.map((item, i) => i === index ? { ...item, [key]: value } as ItemDraft : item));
  }
  function selectSupplier(value: string) {
    setSupplierId(value);
    if (document) return;
    const defaultRequirement = suppliers.find((supplier) => supplier.id === value)?.default_invoice_requirement === "NOT_REQUIRED" ? "NOT_REQUIRED" : "REQUIRED";
    setItems((rows) => rows.map((item) => ({ ...item, invoice_requirement: defaultRequirement })));
  }
  async function submit() {
    if (!canSave) return;
    setError(""); setSaving(true);
    try {
      if (!supplierId) throw new Error("Pilih supplier terlebih dahulu.");
      const payload = {
        supplier_id: supplierId, purchase_date: purchaseDate, supplier_document_no: supplierDocumentNo,
        price_tax_mode: priceTaxMode,
        header_subtotal: subtotal.toFixed(2), header_tax_amount: taxSum.toFixed(2),
        header_total: total.toFixed(2), notes,
        items: items.map((item) => {
          const amounts = itemAmounts(item, priceTaxMode);
          return {
          ...item, quantity: item.quantity, unit_price: item.unit_price,
          purchase_subtotal: amounts.subtotal.toFixed(2), purchase_tax_amount: amounts.tax.toFixed(2),
          purchase_total: amounts.total.toFixed(2),
          invoice_requirement: item.invoice_requirement,
        }; }),
      };
      const result = document
        ? await api<{ id: string }>(`/api/purchase-documents/${document.id}`, { method: "PUT", body: jsonBody(payload) })
        : await api<{ id: string }>("/api/purchase-documents", { method: "POST", body: jsonBody(payload) });
      if (sourceFile) {
        const form = new FormData(); form.append("file", sourceFile); form.append("owner_type", "PURCHASE"); form.append("owner_id", result.id); form.append("category", "PURCHASE_SOURCE");
        await api("/api/attachments", { method: "POST", body: form });
      }
      if (transferFile) {
        const form = new FormData(); form.append("file", transferFile); form.append("owner_type", "PURCHASE"); form.append("owner_id", result.id); form.append("category", "PAYMENT_PROOF");
        await api("/api/attachments", { method: "POST", body: form });
      }
      queryClient.invalidateQueries({ queryKey: ["purchase-files", result.id] });
      notify(document ? "Perubahan pembelian berhasil disimpan." : "Pembelian berhasil disimpan.", "success");
      onSaved();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }
  return <div className="space-y-1">
    <SectionHeading title={document ? "Edit Pembelian" : "Tambah Pembelian"} description="Isi informasi dokumen sekali, lalu tambahkan semua barang di transaksi ini." action={<Button variant="secondary" onClick={onClose}><ArrowLeft size={16} />Kembali ke Pembelian</Button>} />
    <div className="space-y-4">
    <ErrorBanner message={error} />
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
    <div className="mb-4"><h3 className="font-semibold text-slate-900">Informasi Pembelian</h3><p className="mt-0.5 text-xs text-slate-500">Data pemasok dan dokumen sumber transaksi.</p></div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label="Supplier" required><SearchableSelect className={inputClass} value={supplierId} placeholder="Pilih supplier" searchPlaceholder="Cari supplier…" options={suppliers.filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name, sublabel: s.supplier_code }))} onChange={selectSupplier} /></Field>
      <Field label="Tanggal pembelian" required><input type="date" className={inputClass} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
      <Field label="No. nota pembelian"><input className={inputClass} value={supplierDocumentNo} onChange={(e) => setSupplierDocumentNo(e.target.value)} placeholder="Nomor nota pembelian dari supplier" /></Field>
      <div className="md:col-span-2 lg:col-span-3 grid gap-4 sm:grid-cols-2">
        <div>
          <Field label={existingNotes.length > 0 ? "Ganti nota pembelian (Opsional)" : "Nota pembelian (Dokumen sumber)"} hint="PDF, JPG, atau PNG. Maksimal 15 MB. Upload baru otomatis menggantikan file lama."><input type="file" accept=".pdf,.jpg,.jpeg,.png" className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700`} onChange={(e) => setSourceFile(e.target.files?.[0] || null)} /></Field>
          {existingNotes.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className="font-medium text-slate-700">File nota terunggah:</span>{existingNotes.map((f) => <span key={f.id} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{f.original_filename}<button type="button" title="Hapus file nota" onClick={() => void deleteExistingFile(f)} className="text-blue-500 hover:text-rose-600"><X size={12} /></button></span>)}</div>}
        </div>
        <div>
          <Field label={existingTransfers.length > 0 ? "Ganti bukti transfer (Opsional)" : "Bukti transfer (Opsional)"} hint="PDF, JPG, atau PNG. Bukti pembayaran/transfer bank. Upload baru otomatis menggantikan file lama."><input type="file" accept=".pdf,.jpg,.jpeg,.png" className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-emerald-700`} onChange={(e) => setTransferFile(e.target.files?.[0] || null)} /></Field>
          {existingTransfers.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className="font-medium text-slate-700">Bukti transfer terunggah:</span>{existingTransfers.map((f) => <span key={f.id} className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{f.original_filename}<button type="button" title="Hapus bukti transfer" onClick={() => void deleteExistingFile(f)} className="text-emerald-500 hover:text-rose-600"><X size={12} /></button></span>)}</div>}
        </div>
      </div>
    </div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Barang Pembelian</h3><p className="mt-0.5 text-xs text-slate-500">Nilai awal toggle faktur mengikuti pengaturan supplier dan tetap bisa diubah per barang.</p></div><Button type="button" variant="secondary" onClick={() => setItems((rows) => [...rows, newItem(supplierDefaultInvoiceRequirement)])}><Plus size={15} />Tambah Barang</Button></div>
    <div className="mb-4"><PriceTaxModeSwitch mode={priceTaxMode} onChange={setPriceTaxMode} /></div>
    <div className="space-y-3 2xl:hidden">{items.map((item, index) => {
      const invoiceRequired = item.invoice_requirement === "REQUIRED";
      const amounts = itemAmounts(item, priceTaxMode);
      return <article key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-800">Barang {index + 1}</h4><button type="button" disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus barang ${index + 1}`} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-600 text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-4 focus:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={15} aria-hidden="true" /></button></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2"><Field label="Project"><SearchableSelect className={inputClass} value={item.project_id} placeholder="Tanpa project" searchPlaceholder="Cari project…" options={projects.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name, sublabel: p.project_code }))} onChange={(value) => updateItem(index, "project_id", value)} /></Field></div>
          <div className="col-span-2"><Field label="Nama barang"><input className={inputClass} value={item.item_name} onChange={(e) => updateItem(index, "item_name", e.target.value)} placeholder="Nama barang" required /></Field></div>
          <Field label="Qty"><input className={`${inputClass} min-w-0 tabular-nums`} type="text" inputMode="decimal" value={item.quantity} onChange={(e) => updateItem(index, "quantity", quantityInputValue(e.target.value))} onBlur={() => updateItem(index, "quantity", decimalInputValue(item.quantity))} /></Field>
          <Field label="UOM"><input className={inputClass} value={item.uom} onChange={(e) => updateItem(index, "uom", e.target.value)} /></Field>
          <Field label={invoiceRequired ? (priceTaxMode === "INCLUSIVE" ? "Harga (Include PPN)" : "Harga (Exclude PPN)") : "Harga"}><RupiahInput value={item.unit_price} onChange={(value) => updateItem(index, "unit_price", value)} ariaLabel={`Harga barang ${index + 1}`} /></Field>
          <Field label={invoiceRequired ? "PPN 11%" : "PPN · Tidak dikenakan"}><RupiahCalculatedInput value={amounts.tax} ariaLabel={invoiceRequired ? `PPN barang ${index + 1}` : `PPN tidak dikenakan untuk barang ${index + 1}`} /></Field>
          <Field label="Subtotal"><RupiahCalculatedInput value={amounts.subtotal} ariaLabel={`Subtotal barang ${index + 1}`} /></Field>
          <Field label="Total"><RupiahCalculatedInput value={amounts.total} ariaLabel={`Total barang ${index + 1}`} /></Field>
          <div className="col-span-2 flex min-h-[68px] items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 sm:col-span-2"><div><p className="text-xs font-medium text-slate-500">Faktur</p><p className={`mt-1 text-sm font-semibold ${invoiceRequired ? "text-blue-700" : "text-slate-500"}`}>{invoiceRequired ? "Perlu faktur" : "Non faktur"}</p></div><button type="button" role="switch" aria-checked={invoiceRequired} aria-label={`${invoiceRequired ? "Faktur" : "Non faktur"} untuk ${item.item_name || `barang ${index + 1}`}`} onClick={() => updateItem(index, "invoice_requirement", invoiceRequired ? "NOT_REQUIRED" : "REQUIRED")} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-blue-100 ${invoiceRequired ? "bg-blue-600" : "bg-slate-300"}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${invoiceRequired ? "translate-x-6" : "translate-x-1"}`} /></button></div>
          <div className="col-span-2 sm:col-span-2"><Field label="Ket"><input className={inputClass} value={item.item_notes} onChange={(e) => updateItem(index, "item_notes", e.target.value)} placeholder="Keterangan" aria-label={`Keterangan barang ${index + 1}`} /></Field></div>
        </div>
      </article>;
    })}</div>
    <div className="hidden overflow-hidden rounded-xl border border-slate-200 2xl:block"><table className="w-full table-fixed whitespace-nowrap text-left text-sm"><colgroup><col style={{ width: "12%" }} /><col style={{ width: "14%" }} /><col style={{ width: "7%" }} /><col style={{ width: "6%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "8%" }} /><col style={{ width: "13%" }} /><col style={{ width: "4%" }} /></colgroup><thead className="bg-slate-50 text-[11px] uppercase text-slate-600"><tr><th className="px-2 py-3">Project</th><th className="px-2 py-3">Nama barang</th><th className="px-2 py-3">Qty</th><th className="px-2 py-3">UOM</th><th className="px-2 py-3">Harga</th><th className="px-2 py-3 text-right">Subtotal</th><th className="px-2 py-3">PPN</th><th className="px-2 py-3 text-right">Total</th><th className="px-2 py-3 text-center">Faktur</th><th className="px-2 py-3">Ket</th><th className="px-1 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item, index) => {
      const invoiceRequired = item.invoice_requirement === "REQUIRED";
      const amounts = itemAmounts(item, priceTaxMode);
      return <tr key={index} className="align-top"><td className="p-1.5"><SearchableSelect className={`${inputClass} min-w-0 px-2`} value={item.project_id} placeholder="Tanpa project" searchPlaceholder="Cari project…" options={projects.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name, sublabel: p.project_code }))} onChange={(value) => updateItem(index, "project_id", value)} /></td><td className="p-1.5"><input className={`${inputClass} min-w-0 px-2`} value={item.item_name} onChange={(e) => updateItem(index, "item_name", e.target.value)} placeholder="Nama barang" required /></td><td className="p-1.5"><input className={`${inputClass} min-w-0 px-2 tabular-nums`} type="text" inputMode="decimal" value={item.quantity} onChange={(e) => updateItem(index, "quantity", quantityInputValue(e.target.value))} onBlur={() => updateItem(index, "quantity", decimalInputValue(item.quantity))} aria-label={`Qty barang ${index + 1}`} /></td><td className="p-1.5"><input className={`${inputClass} min-w-0 px-2`} value={item.uom} onChange={(e) => updateItem(index, "uom", e.target.value)} aria-label={`UOM barang ${index + 1}`} /></td><td className="p-1.5"><RupiahInput compact value={item.unit_price} onChange={(value) => updateItem(index, "unit_price", value)} ariaLabel={`Harga barang ${index + 1}`} /></td><td className="p-1.5"><RupiahCalculatedInput value={amounts.subtotal} ariaLabel={`Subtotal barang ${index + 1}`} /></td><td className="p-1.5"><RupiahCalculatedInput value={amounts.tax} ariaLabel={invoiceRequired ? `PPN 11% barang ${index + 1}` : `PPN tidak dikenakan untuk barang ${index + 1}`} /></td><td className="p-1.5"><RupiahCalculatedInput value={amounts.total} ariaLabel={`Total barang ${index + 1}`} /></td><td className="p-1.5 text-center"><div className="flex h-10 items-center justify-center gap-1"><button type="button" role="switch" aria-checked={invoiceRequired} aria-label={`${invoiceRequired ? "Faktur" : "Non faktur"} untuk ${item.item_name || `barang ${index + 1}`}`} onClick={() => updateItem(index, "invoice_requirement", invoiceRequired ? "NOT_REQUIRED" : "REQUIRED")} className={`relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-blue-100 ${invoiceRequired ? "bg-blue-600" : "bg-slate-300"}`}><span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${invoiceRequired ? "translate-x-[14px]" : "translate-x-1"}`} /></button><span className={`truncate text-[10px] font-semibold ${invoiceRequired ? "text-blue-700" : "text-slate-500"}`}>{invoiceRequired ? "Faktur" : "Non faktur"}</span></div></td><td className="p-1.5"><input className={`${inputClass} min-w-0 px-2`} value={item.item_notes} onChange={(e) => updateItem(index, "item_notes", e.target.value)} placeholder="Keterangan" aria-label={`Keterangan barang ${index + 1}`} /></td><td className="p-1 align-middle"><div className="flex h-10 items-center justify-center"><button type="button" disabled={items.length === 1} onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus barang ${index + 1}`} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-600 text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-4 focus:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={15} aria-hidden="true" /></button></div></td></tr>;
    })}</tbody></table></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"><Field label="Catatan transaksi"><textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan tambahan (opsional)" /></Field></section>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card"><div><p className="text-xs text-slate-600">{items.length} barang dalam transaksi</p><p className="text-lg font-semibold tabular-nums text-slate-900">{money(total)}</p></div><div className="flex gap-2"><Button variant="secondary" disabled={saving} onClick={onClose}>Kembali</Button><span className="inline-flex" title={!canSave && !saving ? saveDisabledHint : undefined}><Button loading={saving} disabled={!canSave} onClick={submit}>{saving ? "Menyimpan…" : document ? "Simpan Perubahan" : "Simpan Pembelian"}</Button></span></div></div>
    </div>
  </div>;
}
