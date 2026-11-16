import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleDollarSign, Download, ExternalLink, FileClock, FileText, FileUp, FileWarning, Folder, FolderOpen, Pencil, Plus, ReceiptText, RotateCcw, Rows3, Search, Table2, Trash2, XCircle } from "lucide-react";
import { api, dateText, dateTimeText, downloadFile, jsonBody, money, monthText, quantityText } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { confirmAction, showUndoToast } from "../lib/swal";
import { InvoiceLink, Project, PurchaseItem, Supplier, TaxInvoice, User } from "../types";
import { Button, EmptyState, ErrorBanner, Field, inputClass, LoadingState, Modal, SectionHeading, StatusBadge, SummaryCards } from "./common";
import { SearchableSelect } from "./SearchableSelect";

type Props = {
  user: User;
  onCreateInvoice: (item?: PurchaseItem) => void;
  onEditInvoice: (invoiceId: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
  navHighlight?: { q?: string; highlightId?: string } | null;
  onClearNavHighlight?: () => void;
};
type InvoiceTableEntry = { item: PurchaseItem; quantity: number; dpp: number; ppn: number; total: number };
type InvoiceTableGroup = { key: string; invoice?: InvoiceLink; purchaseDate: string; purchaseGroupCode: string; supplierName: string; entries: InvoiceTableEntry[] };
type InvoiceTableRow = { key: string; group: InvoiceTableGroup; entry: InvoiceTableEntry };
type InvoiceFilePreview = { id: string; nsfp: string; original_filename: string; mime_type: string; version?: number };

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
function invoiceTableStatus(invoice?: InvoiceLink) {
  if (!invoice) return "UNLINKED";
  if (invoice.file_replacement_pending) return "CANCELLED";
  return ["RECEIVED", "UNDER_REVIEW", "VERIFIED"].includes(invoice.lifecycle_status)
    ? "RECORDED"
    : invoice.lifecycle_status;
}

function invoiceVersionFilename(nsfp: string, version: number, originalFilename: string) {
  const safeNsfp = nsfp.trim().replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "faktur";
  const extension = originalFilename.match(/\.(pdf|jpe?g|png)$/i)?.[1]?.toLowerCase() || "pdf";
  return `${safeNsfp}-V${version}.${extension}`;
}

function invoiceFileSummary(file: File) {
  const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase();
  const type = extension === "JPEG" ? "JPG" : extension || "File";
  const size = file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${type} · ${size}`;
}

function ReasonQuote({ label, text, tone = "slate", className = "mt-2" }: { label: string; text: string; tone?: "slate" | "rose"; className?: string }) {
  const colors = tone === "rose"
    ? "border-rose-400 bg-rose-50/70 text-rose-900"
    : "border-blue-300 bg-slate-50 text-slate-700";
  const labelColor = tone === "rose" ? "text-rose-700" : "text-blue-700";
  return <blockquote className={`${className} w-fit max-w-full rounded-r-md border-l-2 px-2 py-1 text-xs leading-relaxed ${colors}`}><span className={`font-semibold ${labelColor}`}>{label}: </span><span className="whitespace-pre-wrap">{text}</span></blockquote>;
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

export function InvoicePage({ user, onCreateInvoice, onEditInvoice, notify, navHighlight, onClearNavHighlight }: Props) {
  const defaultDateRange = useMemo(() => thisMonthDateRange(), []);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [supplierId, setSupplierId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "unlinked" | "complete" | "replacement">("");
  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [view, setView] = useState<"grouped" | "flat">("flat");
  const [groupsPage, setGroupsPage] = useState(1);
  const [groupsPageSize, setGroupsPageSize] = useState(15);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<InvoiceFilePreview | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();

  useEffect(() => {
    if (navHighlight?.q) {
      setSearch(navHighlight.q);
    }
  }, [navHighlight?.q]);
  const params = new URLSearchParams();
  if (debouncedSearch) params.set("q", debouncedSearch);
  if (supplierId) params.set("supplierId", supplierId);
  if (projectId && projectId !== "none") params.set("projectId", projectId);
  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ["invoice-items", debouncedSearch, supplierId, projectId],
    queryFn: () => api<PurchaseItem[]>(`/api/purchase-items/invoice-items?${params}`),
  });
  const { data: allCoverageItems = [], isLoading: coverageLoading } = useQuery({
    queryKey: ["invoice-items", "coverage-summary"],
    queryFn: () => api<PurchaseItem[]>("/api/purchase-items/invoice-items"),
  });
  const { data: invoiceSummary, isLoading: invoiceSummaryLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<{ active_invoices_this_month: number; active_invoice_ppn_this_month: number; replacement_invoices_pending: number }>("/api/dashboard-summary"),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/api/suppliers") });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const canWork = user.role === "TAX_STAFF" || user.role === "ADMIN";
  const itemsWithoutInvoice = useMemo(() => allCoverageItems.filter((item) => {
    if (item.invoice_requirement !== "REQUIRED") return false;
    const coveredQuantity = (item.invoice_links || [])
      .filter((invoice) => !["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status) && !invoice.file_replacement_pending)
      .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.allocated_quantity) || 0), 0);
    return coveredQuantity <= 0.0001;
  }).length, [allCoverageItems]);
  const tableGroups = useMemo(() => {
    const groups = new Map<string, InvoiceTableGroup>();
    const getGroup = (key: string, item: PurchaseItem, invoice?: InvoiceLink) => {
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          invoice,
          purchaseDate: item.purchase_date || "",
          purchaseGroupCode: item.purchase_group_code || "Nota pembelian",
          supplierName: item.supplier_name || "—",
          entries: [],
        };
        groups.set(key, group);
      }
      return group;
    };

    for (const item of items) {
      const links = item.invoice_links || [];
      for (const allocation of links) {
        if (allocation.lifecycle_status === "REPLACED") continue;
        const group = getGroup(`invoice:${allocation.id}`, item, allocation);
        const allocatedQuantity = Number(allocation.allocated_quantity || 0);
        const allocatedDpp = Number(allocation.allocated_dpp || 0);
        const allocatedPpn = Number(allocation.allocated_ppn || 0);
        const allocatedTotal = Number(allocation.allocated_total || 0);
        const fallbackToPurchase = allocatedQuantity <= 0
          || allocation.allocated_dpp == null
          || (allocatedDpp <= 0 && Number(item.purchase_subtotal || 0) > 0)
          || (allocatedTotal <= 0 && allocatedDpp + allocatedPpn > 0);
        const quantity = fallbackToPurchase ? Number(item.quantity || 0) : allocatedQuantity;
        const dpp = fallbackToPurchase ? Number(item.purchase_subtotal || 0) : allocatedDpp;
        const ppn = fallbackToPurchase ? Number(item.purchase_tax_amount || 0) : allocatedPpn;
        group.entries.push({ item, quantity, dpp, ppn, total: fallbackToPurchase ? Number(item.purchase_total ?? dpp + ppn) : Number(allocation.allocated_total ?? dpp + ppn) });
      }

      const activeQuantity = links
        .filter((link) => !["CANCELLED", "REPLACED"].includes(link.lifecycle_status))
        .reduce((sum, link) => sum + (Number(link.allocated_quantity || 0) > 0 ? Number(link.allocated_quantity) : Number(item.quantity || 0)), 0);
      const purchaseQuantity = Number(item.quantity || 0);
      const remainingQuantity = Math.max(0, purchaseQuantity - activeQuantity);
      if (remainingQuantity > 0.0001) {
        const group = getGroup("unlinked", item);
        const ratio = purchaseQuantity > 0 ? remainingQuantity / purchaseQuantity : 0;
        group.entries.push({
          item,
          quantity: remainingQuantity,
          dpp: Number(item.purchase_subtotal || 0) * ratio,
          ppn: Number(item.purchase_tax_amount || 0) * ratio,
          total: Number(item.purchase_total ?? Number(item.purchase_subtotal || 0) + Number(item.purchase_tax_amount || 0)) * ratio,
        });
      }
    }

    return [...groups.values()].sort((a, b) => {
      if (!a.invoice) return b.invoice ? 1 : 0;
      if (!b.invoice) return -1;
      const dateA = a.invoice?.invoice_date || a.purchaseDate;
      const dateB = b.invoice?.invoice_date || b.purchaseDate;
      return dateB.localeCompare(dateA) || (a.invoice?.nsfp || a.purchaseGroupCode).localeCompare(b.invoice?.nsfp || b.purchaseGroupCode);
    });
  }, [items]);
  const statusCounts = useMemo(() => {
    let all = 0;
    let unlinked = 0;
    let complete = 0;
    let replacement = 0;

    for (const group of tableGroups) {
      const isUnlinked = !group.invoice;
      const isReplacement = Boolean(group.invoice && (group.invoice.file_replacement_pending || group.invoice.lifecycle_status === "CANCELLED"));
      const isComplete = Boolean(group.invoice && !isReplacement);

      const dateMatches = (date: string) => {
        const day = date.slice(0, 10);
        return (!dateRange.from || day >= dateRange.from) && (!dateRange.to || day <= dateRange.to);
      };
      if (group.invoice && !dateMatches(group.invoice.invoice_date)) continue;
      if (!group.invoice && !group.entries.some((e) => dateMatches(e.item.purchase_date || group.purchaseDate))) continue;

      const matchingEntries = projectId
        ? group.entries.filter((entry) => projectId === "none" ? !entry.item.project_id : entry.item.project_id === projectId)
        : group.entries;
      if (!matchingEntries.length) continue;

      const count = matchingEntries.length;
      all += count;
      if (isUnlinked) unlinked += count;
      if (isComplete) complete += count;
      if (isReplacement) replacement += count;
    }

    return { all, unlinked, complete, replacement };
  }, [tableGroups, dateRange.from, dateRange.to, projectId]);

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let all = 0;
    let none = 0;

    for (const group of tableGroups) {
      const dateMatches = (date: string) => {
        const day = date.slice(0, 10);
        return (!dateRange.from || day >= dateRange.from) && (!dateRange.to || day <= dateRange.to);
      };
      if (group.invoice && !dateMatches(group.invoice.invoice_date)) continue;
      if (!group.invoice && !group.entries.some((e) => dateMatches(e.item.purchase_date || group.purchaseDate))) continue;

      if (statusFilter === "unlinked" && group.invoice) continue;
      if (statusFilter === "complete" && (!group.invoice || group.invoice.lifecycle_status === "CANCELLED" || group.invoice.file_replacement_pending)) continue;
      if (statusFilter === "replacement" && (!group.invoice || (!group.invoice.file_replacement_pending && group.invoice.lifecycle_status !== "CANCELLED"))) continue;

      for (const entry of group.entries) {
        all++;
        if (!entry.item.project_id) {
          none++;
        } else {
          counts.set(entry.item.project_id, (counts.get(entry.item.project_id) || 0) + 1);
        }
      }
    }

    return { all, none, get: (id: string) => counts.get(id) || 0 };
  }, [tableGroups, dateRange.from, dateRange.to, statusFilter]);

  const filteredTableGroups = useMemo(() => tableGroups.flatMap((group) => {
    let entries = projectId
      ? group.entries.filter((entry) => projectId === "none" ? !entry.item.project_id : entry.item.project_id === projectId)
      : group.entries;
    if (!entries.length) return [];
    const dateMatches = (date: string) => {
      const day = date.slice(0, 10);
      return (!dateRange.from || day >= dateRange.from) && (!dateRange.to || day <= dateRange.to);
    };
    if (group.invoice) {
      if (!dateMatches(group.invoice.invoice_date)) return [];
    } else {
      entries = entries.filter((entry) => dateMatches(entry.item.purchase_date || group.purchaseDate));
      if (!entries.length) return [];
    }

    if (statusFilter === "unlinked") {
      if (group.invoice) return [];
    } else if (statusFilter === "complete") {
      if (!group.invoice || group.invoice.lifecycle_status === "CANCELLED" || group.invoice.file_replacement_pending) return [];
    } else if (statusFilter === "replacement") {
      if (!group.invoice || (!group.invoice.file_replacement_pending && group.invoice.lifecycle_status !== "CANCELLED")) return [];
    }

    return [{ ...group, entries }];
  }), [dateRange.from, dateRange.to, projectId, statusFilter, tableGroups]);
  const flatTableRows = useMemo(() => filteredTableGroups.flatMap((group) => group.entries.map((entry, index) => ({
    key: `${group.key}:${entry.item.id}:${index}`,
    group,
    entry,
  }))), [filteredTableGroups]);
  const displayedCount = view === "flat" ? flatTableRows.length : filteredTableGroups.length;
  const displayedPageCount = Math.max(1, Math.ceil(displayedCount / groupsPageSize));
  const currentGroupsPage = Math.min(groupsPage, displayedPageCount);
  const pageTableGroups = useMemo(() => filteredTableGroups.slice((currentGroupsPage - 1) * groupsPageSize, currentGroupsPage * groupsPageSize), [currentGroupsPage, filteredTableGroups, groupsPageSize]);
  const pageTableRows = useMemo(() => flatTableRows.slice((currentGroupsPage - 1) * groupsPageSize, currentGroupsPage * groupsPageSize), [currentGroupsPage, flatTableRows, groupsPageSize]);

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
  }, [navHighlight?.highlightId, items, filteredTableGroups]);
  const groupPageNumbers = useMemo(() => {
    if (displayedPageCount <= 7) return Array.from({ length: displayedPageCount }, (_, index) => index + 1);
    const candidates = Array.from(new Set([1, 2, currentGroupsPage - 1, currentGroupsPage, currentGroupsPage + 1, displayedPageCount - 1, displayedPageCount]))
      .filter((page) => page >= 1 && page <= displayedPageCount).sort((a, b) => a - b);
    const pages: Array<number | string> = [];
    candidates.forEach((page, index) => {
      if (index > 0 && page - candidates[index - 1] > 1) pages.push(`ellipsis-${candidates[index - 1]}-${page}`);
      pages.push(page);
    });
    return pages;
  }, [currentGroupsPage, displayedPageCount]);

  useEffect(() => {
    setGroupsPage(1);
  }, [debouncedSearch, supplierId, projectId, dateRange.from, dateRange.to, groupsPageSize, view]);

  useEffect(() => {
    if (groupsPage > displayedPageCount) setGroupsPage(displayedPageCount);
  }, [groupsPage, displayedPageCount]);

  const hasActiveFilters = Boolean(search.trim() || supplierId || projectId || statusFilter
    || dateRange.from !== defaultDateRange.from || dateRange.to !== defaultDateRange.to);

  function toggleGroup(groupKey: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }

  async function deleteDraftInvoice(invoice: InvoiceLink) {
    if (invoice.lifecycle_status !== "DRAFT") return;
    if (!(await confirmAction({ title: `Hapus draft ${invoice.nsfp}?`, text: "Draft faktur akan dihapus permanen. Faktur yang sudah diajukan atau diproses tidak dapat dihapus.", confirmButtonText: "Ya, Hapus", danger: true }))) return;
    try {
      await api(`/api/tax-invoices/${invoice.id}`, { method: "DELETE" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice-items"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items-available"] }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["purchases"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      notify(`Draft ${invoice.nsfp} dihapus.`, "success");
    } catch (e: any) { notify(e.message, "error"); }
  }
  return <div>
    <SectionHeading title="Faktur Pajak" description="Pantau barang wajib faktur dan kelengkapan faktur pada setiap nota pembelian." action={canWork ? <Button onClick={() => onCreateInvoice()}><Plus size={16} />Input Faktur</Button> : undefined} />
    <SummaryCards cards={[
      { label: "Faktur tercatat bulan ini", value: invoiceSummary?.active_invoices_this_month ?? 0, unit: "faktur", detail: "Jumlah faktur bertanggal bulan ini", icon: ReceiptText, tone: "blue", loading: invoiceSummaryLoading },
      { label: "Nilai PPN bulan ini", value: money(invoiceSummary?.active_invoice_ppn_this_month), detail: "Total PPN faktur bulan ini", icon: CircleDollarSign, tone: "emerald", loading: invoiceSummaryLoading },
      { label: "Barang belum ada faktur", value: itemsWithoutInvoice, unit: "barang", detail: "Barang wajib faktur yang belum tertaut", icon: FileWarning, tone: "amber", loading: coverageLoading },
      { label: "Menunggu faktur pengganti", value: invoiceSummary?.replacement_invoices_pending ?? 0, unit: "faktur", detail: "Versi terakhir dibatalkan dan belum diganti", icon: FileClock, tone: "violet", loading: invoiceSummaryLoading },
    ]} />
    <section className="mb-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-card">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari kode, supplier, nota, project, barang…" /></div>
        <div className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2" role="group" aria-label="Rentang tanggal faktur">
          <label className="flex min-w-0 flex-col justify-center px-0.5"><span className="text-[9px] font-semibold uppercase leading-3 tracking-wide text-slate-400">Dari</span><input type="date" aria-label="Tanggal mulai" title="Tanggal mulai" value={dateRange.from} max={dateRange.to || undefined} onChange={(event) => { setDateRange((range) => ({ ...range, from: event.target.value })); setGroupsPage(1); }} className="h-5 w-[116px] min-w-0 bg-transparent text-xs font-medium text-slate-700 outline-none" /></label>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-slate-200" />
          <label className="flex min-w-0 flex-col justify-center px-0.5"><span className="text-[9px] font-semibold uppercase leading-3 tracking-wide text-slate-400">Sampai</span><input type="date" aria-label="Tanggal akhir" title="Tanggal akhir" value={dateRange.to} min={dateRange.from || undefined} onChange={(event) => { setDateRange((range) => ({ ...range, to: event.target.value })); setGroupsPage(1); }} className="h-5 w-[116px] min-w-0 bg-transparent text-xs font-medium text-slate-700 outline-none" /></label>
        </div>
        <SearchableSelect className={`${inputClass} xl:w-[210px]`} value={supplierId} placeholder="Semua supplier" searchPlaceholder="Cari supplier…" options={suppliers.filter((supplier) => supplier.is_active).map((supplier) => ({ value: supplier.id, label: supplier.name, sublabel: supplier.supplier_code }))} onChange={setSupplierId} />
        <div className="inline-flex w-fit shrink-0 items-center rounded-xl bg-slate-100 p-1">
          <button type="button" aria-pressed={view === "grouped"} onClick={() => { setView("grouped"); setGroupsPage(1); }} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${view === "grouped" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><Rows3 size={15} />Grouped</button>
          <button type="button" aria-pressed={view === "flat"} onClick={() => { setView("flat"); setGroupsPage(1); }} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${view === "flat" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><Table2 size={15} />Per barang</button>
        </div>
      </div>
      <div className="flex max-w-full items-center gap-2 overflow-x-auto border-t border-slate-100 pt-2 pb-1">
        <span className="shrink-0 text-xs font-semibold text-slate-500">Status Faktur</span>
        <div role="group" aria-label="Filter status faktur" className="flex shrink-0 gap-1">
          {[
            { value: "", label: "Semua", count: statusCounts.all },
            { value: "unlinked", label: "Tanpa Faktur", count: statusCounts.unlinked },
            { value: "complete", label: "Faktur Lengkap", count: statusCounts.complete },
            { value: "replacement", label: "Perlu Pengganti", count: statusCounts.replacement },
          ].map((tab) => {
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value || "all-status"}
                type="button"
                aria-pressed={active}
                onClick={() => { setStatusFilter(tab.value as any); setGroupsPage(1); }}
                className={`inline-flex items-center gap-1.5 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-blue-700 text-white shadow-sm" : "text-blue-800 hover:bg-blue-50"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  active ? "bg-white/25 text-white" : "bg-blue-100 text-blue-800"
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex max-w-full items-center gap-2 overflow-x-auto border-t border-slate-100 pt-2 pb-0.5">
        <span className="shrink-0 text-xs font-semibold text-slate-500">Filter Project</span>
        <div role="group" aria-label="Filter project" className="flex shrink-0 gap-1">
          {[
            { value: "", label: "Semua project", count: projectCounts.all },
            ...projects.map((project) => ({ value: project.id, label: project.name, count: projectCounts.get(project.id) })),
            { value: "none", label: "Tanpa project", count: projectCounts.none },
          ].map((tab) => {
            const active = projectId === tab.value;
            return (
              <button
                key={tab.value || "all-projects"}
                type="button"
                aria-pressed={active}
                onClick={() => { setProjectId(tab.value); setGroupsPage(1); }}
                className={`inline-flex items-center gap-1.5 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active ? "bg-blue-700 text-white shadow-sm" : "text-blue-800 hover:bg-blue-50"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  active ? "bg-white/25 text-white" : "bg-blue-100 text-blue-800"
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={!hasActiveFilters}
          onClick={() => {
            setSearch("");
            setSupplierId("");
            setProjectId("");
            setStatusFilter("");
            setDateRange(defaultDateRange);
            setGroupsPage(1);
          }}
          className="ml-auto inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={13} />
          Reset semua filter
        </button>
      </div>
    </section>
    <ErrorBanner message={error instanceof Error ? error.message : null} />
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      {isLoading ? <LoadingState label="Mengambil daftar barang berfaktur…" /> : !displayedCount ? <div className="p-4"><EmptyState title={tableGroups.some((group) => group.invoice) ? "Tidak ada data yang cocok" : "Belum ada faktur terinput"} description={tableGroups.some((group) => group.invoice) ? "Coba ubah rentang tanggal atau filter yang dipilih." : "Tabel ini menampilkan barang yang perlu ditautkan ke faktur."} /></div> : view === "flat" ? <div className="overflow-x-auto"><table className="w-full min-w-[1500px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-3">Tanggal</th><th className="px-3 py-3">No. faktur</th><th className="px-3 py-3">Supplier</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Nama barang</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3">UOM</th><th className="px-3 py-3 text-right">Harga</th><th className="px-3 py-3 text-right">Sub total</th><th className="px-3 py-3 text-right">PPN</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{pageTableRows.map(({ key, group, entry }) => {
        const invoice = group.invoice;
        const { item } = entry;
        const canDelete = invoice?.lifecycle_status === "DRAFT";
        const canEdit = Boolean(invoice && canWork && !["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status));
        const unitPrice = entry.quantity > 0 ? entry.dpp / entry.quantity : Number(item.unit_price || 0);
        return <tr key={key} id={`row-item-${item.id}`} className="transition hover:bg-slate-50/70">
          <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{dateText(invoice?.invoice_date || item.purchase_date || group.purchaseDate)}</td>
          <td className="whitespace-nowrap px-3 py-2.5">{invoice ? <button type="button" onClick={() => setSelectedInvoiceId(invoice.id)} className="font-medium text-blue-700 hover:text-blue-900 hover:underline">{invoice.nsfp}</button> : <span className="text-slate-400">—</span>}</td>
          <td className="whitespace-nowrap px-3 py-2.5">{group.supplierName}</td>
          <td className="max-w-[180px] whitespace-normal px-3 py-2.5">{item.project_name || "Tanpa project"}</td>
          <td className="max-w-[260px] whitespace-normal px-3 py-2.5 font-medium text-slate-900">{item.item_name}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{quantityText(entry.quantity)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{item.uom}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(unitPrice)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(entry.dpp)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(entry.ppn)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{money(entry.total)}</td>
          <td className="whitespace-nowrap px-3 py-2.5">{invoice?.file_replacement_pending ? <StatusBadge value="FILE_REPLACEMENT_PENDING" /> : invoice ? <StatusBadge value={invoiceTableStatus(invoice)} /> : <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Belum tertaut</span>}</td>
          <td className="whitespace-nowrap px-3 py-2.5"><div className="flex items-center gap-1.5">{invoice && canWork ? <><Button variant="secondary" title={`Edit faktur ${invoice.nsfp}`} className="px-2.5 py-1.5 text-xs" disabled={!canEdit} onClick={() => onEditInvoice(invoice.id)}><Pencil size={13} />Edit</Button><Button variant="dangerGhost" title={canDelete ? `Hapus draft ${invoice.nsfp}` : "Hanya faktur berstatus Draft yang bisa dihapus."} className="px-2 py-1.5 text-xs" disabled={!canDelete} onClick={() => void deleteDraftInvoice(invoice)}><Trash2 size={13} /></Button></> : !invoice && canWork ? <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => onCreateInvoice(item)}><Plus size={13} />Input faktur</Button> : <span className="text-slate-400">—</span>}</div></td>
        </tr>;
      })}</tbody></table></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1220px] table-fixed text-left text-sm"><colgroup><col className="w-[205px]" /><col className="w-[295px]" /><col className="w-[82px]" /><col className="w-[90px]" /><col className="w-[145px]" /><col className="w-[155px]" /><col className="w-[135px]" /><col className="w-[155px]" /></colgroup><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-3">Project</th><th className="px-3 py-3">Nama barang</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3">UOM</th><th className="px-3 py-3 text-right">Harga</th><th className="px-3 py-3 text-right">Sub total</th><th className="px-3 py-3 text-right">PPN</th><th className="px-3 py-3 text-right">Total</th></tr></thead><tbody className="divide-y divide-slate-100">{pageTableGroups.map((group) => {
        const invoice = group.invoice;
        const collapsed = collapsedGroups.has(group.key);
        const subtotal = group.entries.reduce((sum, entry) => sum + entry.dpp, 0);
        const ppn = group.entries.reduce((sum, entry) => sum + entry.ppn, 0);
        const total = group.entries.reduce((sum, entry) => sum + entry.total, 0);
        const canDelete = invoice?.lifecycle_status === "DRAFT";
        const canEdit = Boolean(invoice && canWork && !["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status));
        return <Fragment key={group.key}>
          <tr id={invoice ? `row-invoice-${invoice.id}` : undefined} className="bg-white">
            <td colSpan={8} className="border-t border-slate-200 px-4 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" aria-label={collapsed ? "Buka grup faktur" : "Ciutkan grup faktur"} aria-expanded={!collapsed} title={collapsed ? "Buka barang" : "Ciutkan barang"} onClick={() => toggleGroup(group.key)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-blue-600 shadow-sm transition hover:bg-blue-50">{collapsed ? <Folder size={18} /> : <FolderOpen size={18} />}</button>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold text-slate-900">{invoice ? <button type="button" aria-label={`Buka detail faktur ${invoice.nsfp}`} title={`Buka detail faktur ${invoice.nsfp}`} onClick={() => setSelectedInvoiceId(invoice.id)} className="group inline-flex items-center gap-1.5 rounded-sm text-left leading-none text-slate-800 transition hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><span className="leading-none">{invoice.nsfp}</span><ExternalLink size={16} strokeWidth={2.2} aria-hidden="true" className="shrink-0 -translate-y-0.5 text-blue-600 transition group-hover:text-blue-700" /></button> : "Belum ada nomor faktur"}</span><span className="text-sm font-normal leading-5 text-slate-600">{invoice ? <>{dateText(invoice.invoice_date)} <span className="px-1">·</span> {group.supplierName} <span className="px-1">·</span> {group.entries.length} barang</> : `${group.entries.length} barang belum tertaut ke faktur`}</span></div>
                </div>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-x-6 gap-y-2">
                  <div className="flex shrink-0 items-center gap-3"><div className="flex flex-wrap items-center gap-2">{invoice?.file_replacement_pending ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800" title="Versi file faktur dibatalkan dan sedang menunggu faktur pengganti."><span className="font-semibold">Versi dibatalkan</span><span aria-hidden="true">·</span>menunggu faktur pengganti</span> : <StatusBadge value={invoiceTableStatus(invoice)} />}</div>{invoice && canWork && <><span aria-hidden="true" className="h-6 border-l border-slate-300" /><div className="flex items-center gap-2"><Button variant="secondary" title={`Edit atau revisi faktur ${invoice.nsfp}`} className="px-2.5 py-1.5 text-xs" disabled={!canEdit} onClick={() => onEditInvoice(invoice.id)}><Pencil size={13} />Edit</Button><Button variant="dangerGhost" title={canDelete ? `Hapus draft ${invoice.nsfp}` : "Hanya faktur berstatus Draft yang bisa dihapus agar riwayat faktur tetap terjaga."} className="px-2.5 py-1.5 text-xs" disabled={!canDelete} onClick={() => void deleteDraftInvoice(invoice)}><Trash2 size={13} />Delete</Button></div></>}</div>
                </div>
              </div>
            </td>
          </tr>
          {!collapsed && group.entries.map((entry, index) => {
            const { item } = entry;
            const isLast = index === group.entries.length - 1;
            const connectorStart = index === 0 ? "top-[-8px]" : "top-[-11px]";
            const connectorEnd = isLast
              ? index === 0 ? "h-1/2 rounded-b-full" : "h-[calc(50%+3px)] rounded-b-full"
              : "bottom-[-11px]";
            const elbowWidth = isLast ? "w-2" : "w-4";
            const unitPrice = entry.quantity > 0 ? entry.dpp / entry.quantity : Number(item.unit_price || 0);
            return <tr key={`${group.key}:${item.id}:${index}`} id={`row-item-${item.id}`} className="bg-white transition hover:bg-slate-50/70">
              <td className="whitespace-normal break-words px-3 py-2 align-middle"><div className="relative flex min-h-8 items-center pl-9"><span aria-hidden="true" className={`absolute left-[13px] ${connectorStart} border-l border-slate-300 ${connectorEnd}`} /><span aria-hidden="true" className={`absolute left-[13px] top-1/2 h-2 ${elbowWidth} -translate-y-full rounded-bl-lg border-b border-l border-slate-300`} /><span className="text-slate-700">{item.project_name || "Tanpa project"}</span></div></td>
              <td className="whitespace-normal break-words px-3 py-2 align-middle"><span className="font-medium text-slate-900">{item.item_name}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums">{quantityText(entry.quantity)}</td>
              <td className="whitespace-nowrap px-3 py-2 align-middle text-slate-700">{item.uom}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums">{money(unitPrice)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums">{money(entry.dpp)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums">{money(entry.ppn)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-medium tabular-nums">{money(entry.total)}</td>
            </tr>;
          })}
          {!collapsed && <tr className="border-t-2 border-slate-200 bg-white">
            <td colSpan={5} className="px-3 py-2.5 text-center text-sm font-bold uppercase tracking-wide text-slate-700">Total faktur</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-700">{money(subtotal)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-slate-700">{money(ppn)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold tabular-nums text-slate-900">{money(total)}</td>
          </tr>}
        </Fragment>;
      })}</tbody></table></div>}
      {!isLoading && displayedCount > 0 && <footer className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:gap-4">
          <span>Menampilkan <strong className="font-semibold text-slate-800">{(currentGroupsPage - 1) * groupsPageSize + 1} - {Math.min(currentGroupsPage * groupsPageSize, displayedCount)}</strong> dari {displayedCount} {view === "flat" ? "barang" : "faktur"}</span>
          <label className="flex items-center gap-2" htmlFor="invoice-groups-page-size">Per hal:
            <select id="invoice-groups-page-size" value={groupsPageSize} onChange={(event) => setGroupsPageSize(Number(event.target.value))} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">{[15, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select>
          </label>
          {view === "grouped" && <span className="hidden text-slate-400 sm:inline">Klik header NSFP untuk membuka/menutup barang.</span>}
        </div>
        <nav aria-label="Halaman faktur pajak" className="flex items-center gap-1 self-end sm:self-auto">
          <button type="button" aria-label="Halaman pertama" title="Halaman pertama" disabled={currentGroupsPage === 1} onClick={() => setGroupsPage(1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronsLeft size={15} /></button>
          <button type="button" aria-label="Halaman sebelumnya" title="Halaman sebelumnya" disabled={currentGroupsPage === 1} onClick={() => setGroupsPage(currentGroupsPage - 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={15} /></button>
          {groupPageNumbers.map((page) => typeof page === "number"
            ? <button key={page} type="button" aria-label={`Halaman ${page}`} aria-current={currentGroupsPage === page ? "page" : undefined} onClick={() => setGroupsPage(page)} className={`grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-xs font-medium transition ${currentGroupsPage === page ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{page}</button>
            : <span key={page} aria-hidden="true" className="px-1 text-xs text-slate-400">…</span>)}
          <button type="button" aria-label="Halaman berikutnya" title="Halaman berikutnya" disabled={currentGroupsPage === displayedPageCount} onClick={() => setGroupsPage(currentGroupsPage + 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={15} /></button>
          <button type="button" aria-label="Halaman terakhir" title="Halaman terakhir" disabled={currentGroupsPage === displayedPageCount} onClick={() => setGroupsPage(displayedPageCount)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronsRight size={15} /></button>
        </nav>
      </footer>}
    </section>
    {selectedInvoiceId && <InvoiceDetailModal invoiceId={selectedInvoiceId} user={user} onClose={() => setSelectedInvoiceId(null)} onPreviewFile={setPreviewFile} />}
    {previewFile && <InvoiceFilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} notify={notify} />}
  </div>;
}

export function InvoiceEditPage({ invoiceId, onBack, notify, userName, onCreateReplacement }: { invoiceId: string; onBack: () => void; notify: (message: string, kind?: "success" | "error") => void; userName: string; onCreateReplacement: (invoiceId: string) => void }) {
  const queryClient = useQueryClient();
  const { data: invoice, isLoading, error } = useQuery({ queryKey: ["invoice-detail", invoiceId], queryFn: () => api<TaxInvoice>(`/api/tax-invoices/${invoiceId}`), enabled: Boolean(invoiceId) });
  const purchaseItemsQuery = useQuery({
    queryKey: ["invoice-edit-purchase-items", invoice?.supplier_id],
    queryFn: () => {
      const params = new URLSearchParams({ supplierId: invoice?.supplier_id || "" });
      return api<PurchaseItem[]>(`/api/purchase-items/invoice-items?${params}`);
    },
    enabled: Boolean(invoice?.supplier_id),
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileRevisionReason, setFileRevisionReason] = useState("");
  const [nsfp, setNsfp] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [taxPeriodYear, setTaxPeriodYear] = useState("");
  const [taxPeriodMonth, setTaxPeriodMonth] = useState("");
  const [taxPeriodTouched, setTaxPeriodTouched] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [editItemSearch, setEditItemSearch] = useState("");
  const debouncedEditItemSearch = useDebouncedValue(editItemSearch.trim());
  const selectAllEditItemsRef = useRef<HTMLInputElement>(null);
  const [formLoaded, setFormLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [cancellingAttachmentId, setCancellingAttachmentId] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellingVersion, setCancellingVersion] = useState(false);
  const [restoringAttachmentId, setRestoringAttachmentId] = useState("");
  const versions = (invoice?.attachments || []).filter((attachment) => attachment.category === "TAX_INVOICE_PDF");
  const latestVersion = versions[versions.length - 1];
  const latestVersionCancelled = Boolean(invoice && latestVersion && invoice.file_replacement_pending && latestVersion.tax_invoice_id === invoice.id && latestVersion.version_status === "CANCELLED");
  const fileRevisionReasonText = fileRevisionReason.trim();
  const completeFileRevisionReason = fileRevisionReasonText;
  useEffect(() => {
    if (!invoice) return;
    setNsfp(invoice.nsfp);
    const date = invoice.invoice_date.slice(0, 10);
    const datePeriod = periodFromInvoiceDate(date);
    const savedYear = String(invoice.tax_period_year || datePeriod.year);
    const savedMonth = String(invoice.tax_period_month || datePeriod.month);
    setInvoiceDate(date);
    setTaxPeriodYear(savedYear);
    setTaxPeriodMonth(savedMonth);
    setTaxPeriodTouched(savedYear !== datePeriod.year || savedMonth !== datePeriod.month);
    setSelectedItemIds([...new Set((invoice.lines || []).flatMap((line) => (line.allocations || []).map((allocation) => allocation.purchase_item_id))) ]);
    setFormLoaded(true);
  }, [invoice?.id]);
  const metadataChanged = formLoaded && Boolean(invoice && (nsfp.trim() !== invoice.nsfp || invoiceDate !== invoice.invoice_date.slice(0, 10) || Number(taxPeriodYear) !== Number(invoice.tax_period_year) || Number(taxPeriodMonth) !== Number(invoice.tax_period_month)));
  const canEdit = Boolean(invoice && !["CANCELLED", "REPLACED"].includes(invoice.lifecycle_status));
  const invoiceAllocations = (invoice?.lines || []).flatMap((line) => (line.allocations || []).map((allocation: any) => ({ ...allocation, lineDescription: line.description })));
  const currentAllocationsByItem = new Map<string, { quantity: number; dpp: number; ppn: number; other: number; total: number }>();
  for (const allocation of invoiceAllocations) {
    const current = currentAllocationsByItem.get(allocation.purchase_item_id) || { quantity: 0, dpp: 0, ppn: 0, other: 0, total: 0 };
    current.quantity += Number(allocation.allocated_quantity || 0);
    current.dpp += Number(allocation.allocated_dpp || 0);
    current.ppn += Number(allocation.allocated_ppn || 0);
    current.other += Number((allocation as any).allocated_other_tax || 0);
    current.total += Number(allocation.allocated_total || 0);
    currentAllocationsByItem.set(allocation.purchase_item_id, current);
  }
  const editableItems = purchaseItemsQuery.data || [];
  const selectedSourceDocuments = [...new Map(editableItems.filter((item) => selectedItemIds.includes(item.id)).map((item) => [item.purchase_document_id, item])).values()] as PurchaseItem[];
  const visibleEditableItems = useMemo(() => {
    const query = debouncedEditItemSearch.toLocaleLowerCase();
    return editableItems.filter((item) => !query || `${item.item_name} ${item.item_code} ${item.supplier_document_no || ""} ${item.purchase_group_code || ""} ${item.project_name || ""}`.toLocaleLowerCase().includes(query));
  }, [editableItems, debouncedEditItemSearch]);
  const selectableEditItems = visibleEditableItems.filter((item) => item.invoice_requirement === "REQUIRED" && (selectedItemIds.includes(item.id) || Number(item.available_quantity || 0) + Number(currentAllocationsByItem.get(item.id)?.quantity || 0) > 0.0001));
  const allEditItemsSelected = selectableEditItems.length > 0 && selectableEditItems.every((item) => selectedItemIds.includes(item.id));
  const someEditItemsSelected = selectableEditItems.some((item) => selectedItemIds.includes(item.id));
  const originalItemIds = [...currentAllocationsByItem.keys()].sort();
  const selectedItemIdsSorted = [...selectedItemIds].sort();
  const itemsChanged = formLoaded && JSON.stringify(originalItemIds) !== JSON.stringify(selectedItemIdsSorted);
  useEffect(() => {
    if (selectAllEditItemsRef.current) selectAllEditItemsRef.current.indeterminate = someEditItemsSelected && !allEditItemsSelected;
  }, [someEditItemsSelected, allEditItemsSelected]);

  function toggleEditItem(itemId: string) {
    setSelectedItemIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  function toggleAllEditItems() {
    const visibleIds = selectableEditItems.map((item) => item.id);
    setSelectedItemIds((current) => allEditItemsSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  }

  function changeEditInvoiceDate(value: string) {
    setInvoiceDate(value);
    if (!taxPeriodTouched && value) {
      const period = periodFromInvoiceDate(value);
      setTaxPeriodYear(period.year);
      setTaxPeriodMonth(period.month);
    }
  }

  async function saveChanges() {
    if (!invoice || !canEdit || (!metadataChanged && !itemsChanged && !file)) return;
    if (file && latestVersionCancelled) { setFormError("Pulihkan versi terakhir atau buat faktur pengganti sebelum mengunggah file."); return; }
    if (!nsfp.trim() || !invoiceDate) { setFormError("NSFP dan tanggal faktur wajib diisi."); return; }
    if (!isValidTaxPeriod(taxPeriodYear, taxPeriodMonth)) { setFormError("Masa Pajak harus berisi bulan dan tahun yang valid."); return; }
    if (itemsChanged && !selectedItemIds.length) { setFormError("Pilih minimal satu barang yang tercantum dalam faktur."); return; }
    if (file && versions.length && !completeFileRevisionReason) { setFormError("Isi alasan versi baru sebelum mengunggah file pengganti."); return; }
    setSaving(true);
    setFormError("");
    let dataSaved = false;
    try {
      if (metadataChanged || itemsChanged) {
        await api(`/api/tax-invoices/${invoice.id}`, { method: "PUT", body: jsonBody({ nsfp: nsfp.trim(), invoice_date: invoiceDate, tax_period_year: Number(taxPeriodYear), tax_period_month: Number(taxPeriodMonth), ...(itemsChanged ? { purchase_item_ids: selectedItemIds } : {}) }) });
        dataSaved = true;
      }
      if (file) {
        const form = new FormData();
        form.append("file", file, invoiceVersionFilename(nsfp, versions.length + 1, file.name));
        form.append("owner_type", "TAX_INVOICE");
        form.append("owner_id", invoice.id);
        if (completeFileRevisionReason) form.append("revision_reason", completeFileRevisionReason);
        await api("/api/attachments", { method: "POST", body: form });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice-detail", invoiceId] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-edit-purchase-items"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items-available"] }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      notify(file ? `Perubahan tersimpan dan file faktur menjadi versi V${versions.length + 1}.` : itemsChanged ? "Data faktur dan barang terkait berhasil diperbarui." : "Data NSFP dan tanggal faktur berhasil diperbarui.", "success");
      onBack();
    } catch (e: any) {
      setFormError(dataSaved ? `Data faktur sudah tersimpan, tetapi file baru belum terunggah: ${e.message}` : e.message);
      if (dataSaved) await Promise.all([queryClient.invalidateQueries({ queryKey: ["invoice-detail", invoiceId] }), queryClient.invalidateQueries({ queryKey: ["invoice-items"] }), queryClient.invalidateQueries({ queryKey: ["invoice-edit-purchase-items"] })]);
    }
    finally { setSaving(false); }
  }

  async function cancelFileVersion() {
    if (!invoice || !cancellingAttachmentId || !cancellationReason.trim()) return;
    const cancelledAttachmentId = cancellingAttachmentId;
    setCancellingVersion(true);
    try {
      await api(`/api/tax-invoices/${invoice.id}/attachments/${cancelledAttachmentId}/cancel`, { method: "POST", body: jsonBody({ reason: cancellationReason.trim() }) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice-detail", invoiceId] }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items-available"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setFile(null);
      setFileRevisionReason("");
      setCancellingAttachmentId("");
      setCancellationReason("");
      void showUndoToast("Versi file dibatalkan.", () => restoreFileVersion(cancelledAttachmentId, false));
    } catch (error: any) {
      notify(error.message || "Versi file gagal dibatalkan.", "error");
    } finally {
      setCancellingVersion(false);
    }
  }

  async function restoreFileVersion(attachmentId: string, confirm = true) {
    if (!invoice || restoringAttachmentId) return;
    if (confirm) {
      const accepted = await confirmAction({
        title: "Pulihkan versi faktur?",
        text: "Versi ini akan aktif kembali dan status menunggu faktur pengganti akan hilang. Riwayat pembatalan tetap tersimpan.",
        confirmButtonText: "Pulihkan versi",
      });
      if (!accepted) return;
    }
    setRestoringAttachmentId(attachmentId);
    try {
      await api(`/api/tax-invoices/${invoice.id}/attachments/${attachmentId}/restore`, { method: "POST", body: jsonBody({}) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice-detail", invoiceId] }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items"] }),
        queryClient.invalidateQueries({ queryKey: ["invoice-items-available"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      notify("Versi faktur dipulihkan. Catatan pembatalan tetap ada di riwayat.", "success");
    } catch (error: any) {
      notify(error.message || "Versi faktur gagal dipulihkan.", "error");
    } finally {
      setRestoringAttachmentId("");
    }
  }

  return <div className="space-y-5">
    <SectionHeading title="Edit Faktur Pajak" description="Perbaiki data faktur atau unggah file revisi. Riwayat file sebelumnya tetap tersimpan." action={<Button variant="secondary" disabled={saving} onClick={onBack}><ArrowLeft size={15} />Kembali ke Faktur Pajak</Button>} />
    {isLoading ? <section className="rounded-2xl border border-slate-200 bg-white px-4"><LoadingState label="Mengambil data faktur…" /></section> : error ? <ErrorBanner message={(error as Error).message} /> : !invoice ? <ErrorBanner message="Faktur tidak ditemukan." /> : <div className="space-y-4">
      <ErrorBanner message={!canEdit ? "Faktur yang dibatalkan atau sudah diganti tidak dapat diedit." : formError || null} />
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">A</span><div><h3 className="text-sm font-semibold text-slate-900">Pemasok faktur</h3><p className="text-xs text-slate-500">Barang terkait bisa berasal dari beberapa nota, tetapi pemasoknya harus sama.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Pemasok"><input className={`${inputClass} !bg-slate-100 border-slate-300 text-slate-600`} value={invoice.supplier_name} readOnly /></Field><div className="grid grid-cols-2 gap-3"><Field label="Barang dipilih"><input className={`${inputClass} !bg-slate-100 border-slate-300 text-slate-600`} value={`${selectedItemIds.length} barang`} readOnly /></Field><Field label="Nota tercakup"><input className={`${inputClass} !bg-slate-100 border-slate-300 text-slate-600`} value={`${selectedSourceDocuments.length} nota`} readOnly /></Field></div></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">B</span><div><h3 className="text-sm font-semibold text-slate-900">Data Faktur Pajak</h3><p className="text-xs text-slate-500">Koreksi NSFP, tanggal, atau Masa Pajak untuk memperbaiki data internal. Perubahan ini tidak menambah versi file.</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="NSFP" required><input className={inputClass} value={nsfp} maxLength={100} onChange={(event) => setNsfp(event.target.value)} disabled={!canEdit} /></Field>
          <Field label="Tanggal faktur" required><input className={inputClass} type="date" value={invoiceDate} onChange={(event) => changeEditInvoiceDate(event.target.value)} disabled={!canEdit} /></Field>
          <Field label="Masa Pajak" required hint="Terisi otomatis dari tanggal faktur dan bisa disesuaikan."><div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2"><select className={inputClass} value={taxPeriodMonth} disabled={!canEdit} onChange={(event) => { setTaxPeriodMonth(event.target.value); setTaxPeriodTouched(true); }}><option value="">Pilih bulan</option>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{monthText(month)}</option>)}</select><input className={inputClass} aria-label="Tahun Masa Pajak" type="number" min="1900" max="9999" step="1" value={taxPeriodYear} disabled={!canEdit} onChange={(event) => { setTaxPeriodYear(event.target.value); setTaxPeriodTouched(true); }} placeholder="Tahun" /></div></Field>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">C</span><div><h3 className="text-sm font-semibold text-slate-900">Barang yang tercantum dalam faktur</h3><p className="text-xs text-slate-500">Pilih ulang barang dari nota mana pun milik pemasok ini. Barang non-faktur tidak ditampilkan.</p></div></div>
        {purchaseItemsQuery.isLoading ? <LoadingState label="Mengambil barang dari pembelian pemasok…" compact /> : !editableItems.length ? <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">Tidak ada barang pembelian yang tersedia dari pemasok ini.</p> : <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2.5"><div><p className="text-sm font-semibold text-slate-800">{selectedItemIds.length} barang · {selectedSourceDocuments.length} nota</p><p className="text-xs text-slate-500">Pemasok: {invoice.supplier_name}</p></div><span className="text-xs text-slate-500">{selectedItemIds.length} dari {editableItems.filter((item) => item.invoice_requirement === "REQUIRED").length} barang dipilih</span></div>
          <div className="border-b border-slate-100 p-2"><div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} /><input className={`${inputClass} pl-9`} value={editItemSearch} onChange={(event) => setEditItemSearch(event.target.value)} placeholder="Cari nama barang, nota, atau proyek…" /></div></div>
          {!visibleEditableItems.length ? <p className="p-5 text-center text-sm text-slate-500">Tidak ada barang yang cocok dengan pencarian.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1545px] table-fixed text-left text-sm">
            <colgroup><col className="w-[44px]" /><col className="w-[120px]" /><col className="w-[150px]" /><col className="w-[185px]" /><col className="w-[230px]" /><col className="w-[85px]" /><col className="w-[80px]" /><col className="w-[145px]" /><col className="w-[160px]" /><col className="w-[130px]" /><col className="w-[160px]" /></colgroup>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-3 py-3 text-center"><input ref={selectAllEditItemsRef} aria-label="Pilih semua barang berfaktur dari pemasok ini" title="Pilih semua barang yang tersedia" type="checkbox" checked={allEditItemsSelected} disabled={!selectableEditItems.length || !canEdit} onChange={toggleAllEditItems} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40" /></th><th className="px-3 py-3">Tanggal</th><th className="px-3 py-3">Nota pembelian</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Nama barang</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3">UOM</th><th className="px-3 py-3 text-right">Harga</th><th className="px-3 py-3 text-right">Sub total</th><th className="px-3 py-3 text-right">PPN</th><th className="px-3 py-3 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{visibleEditableItems.map((item) => {
              const checked = selectedItemIds.includes(item.id);
              const nonInvoice = item.invoice_requirement === "NOT_REQUIRED";
              const current = currentAllocationsByItem.get(item.id);
              const availableQuantity = Math.max(0, Number(item.available_quantity || 0) + Number(current?.quantity || 0));
              const quantity = checked && current ? current.quantity : availableQuantity;
              const subtotal = checked && current ? current.dpp : Number(item.quantity) > 0 ? Math.round(Number(item.purchase_subtotal || 0) * quantity / Number(item.quantity) * 100) / 100 : 0;
              const tax = checked && current ? current.ppn : Number(item.quantity) > 0 ? Math.round(Number(item.purchase_tax_amount || 0) * quantity / Number(item.quantity) * 100) / 100 : 0;
              const total = checked && current ? current.total : subtotal + tax;
              const disabled = !canEdit || nonInvoice || (!checked && availableQuantity <= 0.0001);
              return <tr key={item.id} title={nonInvoice ? "Barang non-faktur tidak dapat ditautkan ke faktur pajak." : undefined} className={`transition ${nonInvoice ? "bg-slate-50 text-slate-400" : checked ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                <td className="px-3 py-3 text-center"><input aria-label={`Pilih ${item.item_name}`} type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleEditItem(item.id)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40" /></td>
                <td className={`whitespace-nowrap px-3 py-3 ${nonInvoice ? "text-slate-400" : "text-slate-700"}`}>{dateText(item.purchase_date || "")}</td>
                <td className={`whitespace-normal break-words px-3 py-3 ${nonInvoice ? "text-slate-400" : "text-slate-700"}`}><span className="font-medium text-slate-800">{item.supplier_document_no || item.purchase_group_code || "—"}</span>{item.supplier_document_no && item.purchase_group_code && item.supplier_document_no !== item.purchase_group_code && <span className="mt-0.5 block text-xs text-slate-500">{item.purchase_group_code}</span>}</td>
                <td className={`whitespace-normal break-words px-3 py-3 ${nonInvoice ? "text-slate-400" : "text-slate-700"}`}>{item.project_name || "Tanpa project"}</td>
                <td className={`break-words px-3 py-3 font-medium ${nonInvoice ? "text-slate-400" : "text-slate-900"}`}>{item.item_name}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${nonInvoice ? "text-slate-400" : "text-slate-800"}`}>{quantityText(quantity)}</td>
                <td className={`whitespace-nowrap px-3 py-3 ${nonInvoice ? "text-slate-400" : "text-slate-700"}`}>{item.uom}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${nonInvoice ? "text-slate-400" : "text-slate-800"}`}>{money(item.unit_price)}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${nonInvoice ? "text-slate-400" : "text-slate-800"}`}>{money(subtotal)}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${nonInvoice ? "text-slate-400" : "text-slate-800"}`}>{money(tax)}</td>
                <td className={`whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums ${nonInvoice ? "text-slate-400" : "text-slate-900"}`}>{money(total)}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        </div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">D</span><div><h3 className="text-sm font-semibold text-slate-900">File faktur pajak</h3><p className="text-xs text-slate-500">File lama tetap tersimpan. Setiap file pengganti punya alasan sendiri di riwayat versi.</p></div></div>
        {invoice.lifecycle_status === "REPLACED" && invoice.replacement_invoice_id && <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3"><p className="text-sm font-semibold text-slate-900">Faktur ini sudah digantikan</p><p className="mt-0.5 text-xs leading-relaxed text-slate-600">NSFP pengganti {invoice.replacement_nsfp} tercatat. Riwayat faktur lama tetap disimpan, sementara barangnya dihitung pada faktur pengganti.</p></div>}
        {latestVersionCancelled && <div className="mb-3 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-amber-900">Versi file terbaru dibatalkan</p>{invoice.replacement_invoice_id ? <p className="mt-0.5 text-xs leading-relaxed text-amber-800">Faktur pengganti {invoice.replacement_nsfp} sedang disiapkan ({invoice.replacement_lifecycle_status || "Draft"}). Versi lama tidak dapat dipulihkan setelah faktur pengganti dibuat.</p> : <p className="mt-0.5 text-xs leading-relaxed text-amber-800">Jika pembatalan tidak sengaja, pulihkan versi di riwayat. Jika supplier menerbitkan NSFP berbeda, buat faktur pengganti.</p>}</div>{!invoice.replacement_invoice_id && <Button variant="secondary" className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100" onClick={() => onCreateReplacement(invoice.id)}>Buat faktur pengganti</Button>}</div>}
        {latestVersionCancelled ? <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-600">Unggahan versi baru dikunci sampai versi terakhir dipulihkan atau faktur pengganti dibuat.</div> : <label className={`flex min-h-24 flex-col items-center justify-center rounded-xl border border-dashed px-4 py-4 text-center transition ${canEdit ? "cursor-pointer border-blue-300 bg-blue-50/40 hover:bg-blue-50" : "cursor-not-allowed border-slate-200 bg-slate-50"}`}><FileUp size={20} className="mb-1 text-blue-700" /><span className="text-sm font-semibold text-slate-800">{file ? "Pilih file lain" : `Pilih PDF atau gambar faktur pajak${versions.length ? ` · versi berikutnya V${versions.length + 1}` : ""}`}</span><span className="mt-1 text-xs text-slate-500">PDF, JPG, atau PNG · maksimal 15 MB · satu file</span><input className="sr-only" type="file" disabled={!canEdit} accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => { setFile(event.target.files?.[0] || null); setFormError(""); event.currentTarget.value = ""; }} /></label>}
        {!latestVersionCancelled && !file && versions.length > 0 && <p className="mt-2 text-xs text-slate-500">Saat memilih file pengganti, isi alasan versi baru. Alasan tersebut akan muncul di timeline tiap versi.</p>}
        {file && <div className="mt-4 overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm">
          <div className="border-b border-violet-100 bg-violet-50/60 px-3 py-2.5"><h4 className="text-sm font-semibold text-slate-900">File yang akan diunggah</h4><p className="mt-0.5 text-xs text-slate-600">File ini akan menjadi versi V{versions.length + 1} setelah disimpan.{versions.length === 0 ? " Versi pertama dicatat sebagai Unggahan awal." : ""}</p></div>
          <div className="p-3"><div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700"><FileText size={16} /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{nsfp.trim() || invoice.nsfp} - V{versions.length + 1}<span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Versi terbaru</span></p><p className="mt-0.5 text-xs text-slate-500">{dateTimeText(new Date().toISOString())} · Oleh {userName} · Menunggu disimpan</p><p className="mt-1 text-xs text-slate-600">{invoiceFileSummary(file)}</p>{versions.length === 0 && <p className="mt-1 text-xs font-medium text-slate-700">Alasan: Unggahan awal</p>}</div></div></div>
          {versions.length > 0 && <div className="space-y-3 border-t border-slate-100 p-3"><Field label="Alasan versi baru" required hint="Jelaskan singkat apa yang berubah dan dari siapa informasinya."><textarea className={`${inputClass} min-h-10`} rows={2} maxLength={450} value={fileRevisionReason} disabled={!canEdit} onChange={(event) => { setFileRevisionReason(event.target.value); setFormError(""); }} placeholder="Contoh: supplier mengirim faktur pengganti karena tanggal sebelumnya salah." /></Field><p className="text-xs leading-relaxed text-slate-600">Kalau hanya salah input di aplikasi dan file supplier tetap sama, koreksi datanya di bagian atas tanpa mengunggah versi baru.</p></div>}
        </div>}
        <div className={`${file ? "mt-5" : "mt-4"} border-t border-slate-100 pt-4`}><h4 className="mb-3 text-sm font-semibold text-slate-900">Riwayat versi file</h4>{versions.length ? <ol className="space-y-1">{versions.slice().reverse().map((attachment, index) => {
          const version = attachment.version_number || versions.length - index;
          const latest = index === 0;
          const versionStatus = attachment.version_status || (latest ? "ACTIVE" : "SUPERSEDED");
          const canCancelThisVersion = canEdit && latest && versionStatus === "ACTIVE";
          const canRestoreThisVersion = canEdit && latest && latestVersionCancelled && versionStatus === "CANCELLED" && attachment.tax_invoice_id === invoice.id && !invoice.replacement_invoice_id;
          return <li key={attachment.id} className="relative flex gap-3 pb-1">
            <div className="relative flex w-8 shrink-0 justify-center">{index < versions.length - 1 && <span aria-hidden="true" className="absolute bottom-[-0.25rem] left-1/2 top-8 w-px -translate-x-1/2 bg-slate-200" />}<span className={`relative z-10 grid h-8 w-8 place-items-center rounded-xl border ${versionStatus === "CANCELLED" ? "border-rose-200 bg-rose-50 text-rose-700" : latest ? "border-violet-200 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600"}`}><FileText size={15} /></span></div>
            <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3 py-0.5">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-900">{attachment.version_nsfp || invoice.nsfp} - V{version}</p><StatusBadge value={versionStatus} />{latest && !file && versionStatus !== "CANCELLED" && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">Terbaru</span>}</div>
                <p className="mt-1 text-xs text-slate-500">{dateTimeText(attachment.uploaded_at)}{attachment.uploaded_by_name ? ` · Oleh ${attachment.uploaded_by_name}` : ""}</p>
                <div className="mt-1.5 flex flex-wrap items-start gap-x-2 gap-y-1">
                  <ReasonQuote className="mt-0" label="Alasan versi" text={attachment.revision_reason || (attachment.supersedes_attachment_id ? "Alasan belum dicatat" : "Unggahan awal")} />
                  {attachment.cancellation_reason && <ReasonQuote className="mt-0" label="Alasan dibatalkan" text={`${attachment.cancellation_reason}${attachment.cancelled_at ? ` · ${dateTimeText(attachment.cancelled_at)}` : ""}${attachment.cancelled_by_name ? ` · Oleh ${attachment.cancelled_by_name}` : ""}`} tone="rose" />}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canCancelThisVersion && <Button variant="dangerGhost" className="px-2.5 py-1.5 text-xs" onClick={() => { setCancellingAttachmentId(attachment.id); setCancellationReason(""); }}><XCircle size={14} />Batalkan versi</Button>}
                {canRestoreThisVersion && <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={Boolean(restoringAttachmentId)} loading={restoringAttachmentId === attachment.id} onClick={() => void restoreFileVersion(attachment.id)}><RotateCcw size={14} />Pulihkan versi</Button>}
              </div>
            </div>
          </li>;
        })}</ol> : <p className="text-sm italic text-slate-500">Belum ada file faktur yang tersimpan.</p>}</div>
      </section>
      <div className="flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center"><p className="text-xs text-slate-500">{selectedItemIds.length} barang dipilih</p><div className="flex justify-end gap-2"><Button variant="secondary" disabled={saving} onClick={onBack}>Kembali</Button><Button disabled={!canEdit || (!metadataChanged && !itemsChanged && !file) || (Boolean(file && versions.length) && !completeFileRevisionReason) || !selectedItemIds.length || saving} loading={saving} onClick={() => void saveChanges()}>{saving ? "Menyimpan perubahan…" : file ? "Simpan Perubahan & Versi Baru" : "Simpan Perubahan"}</Button></div></div>
    </div>}
    {cancellingAttachmentId && <Modal title="Batalkan versi faktur?" subtitle={`NSFP ${invoice?.nsfp || ""} · V${versions.find((attachment) => attachment.id === cancellingAttachmentId)?.version_number || versions.length}`} onClose={() => { if (!cancellingVersion) setCancellingAttachmentId(""); }} size="max-w-xl"><div className="space-y-4"><div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-950"><p className="font-semibold">Versi ini akan tetap ada di riwayat.</p><p className="mt-1 text-xs leading-relaxed text-amber-800">Jika pembatalan tidak sengaja, versi masih bisa dipulihkan. Jika supplier menerbitkan NSFP berbeda, buat faktur pengganti.</p></div><Field label="Alasan dibatalkan" required hint="Catat penyebab dan tindak lanjut supaya mudah dipahami nanti."><textarea className={`${inputClass} min-h-24`} rows={3} maxLength={500} autoFocus value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Contoh: Supplier membatalkan faktur ini karena tanggal faktur salah dan akan menerbitkan faktur pengganti." /></Field><div className="flex justify-end gap-2 border-t border-slate-100 pt-3"><Button variant="secondary" disabled={cancellingVersion} onClick={() => setCancellingAttachmentId("")}>Kembali</Button><Button variant="danger" loading={cancellingVersion} disabled={!cancellationReason.trim()} onClick={() => void cancelFileVersion()}>{cancellingVersion ? "Mencatat pembatalan…" : "Batalkan versi"}</Button></div></div></Modal>}
  </div>;
}

function InvoiceFilePreviewModal({ file, onClose, notify }: { file: InvoiceFilePreview; onClose: () => void; notify: (message: string, kind?: "success" | "error") => void }) {
  return <Modal title="Nota Faktur" subtitle={`${file.nsfp}${file.version ? ` · V${file.version}` : ""}`} onClose={onClose} size="max-w-5xl">
    <div className="h-[65vh] min-h-[300px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">{file.mime_type === "application/pdf" ? <iframe title={`Preview nota faktur ${file.nsfp}`} src={`/api/attachments/${file.id}/preview`} className="h-full w-full border-0" /> : <img src={`/api/attachments/${file.id}/preview`} alt={`Preview nota faktur ${file.nsfp}`} className="h-full w-full object-contain" />}</div>
    <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={() => void downloadFile(`/api/attachments/${file.id}/download`, file.original_filename).catch((error: any) => notify(error.message, "error"))}><Download size={14} />Unduh</Button></div>
  </Modal>;
}

function InvoiceDetailModal({ invoiceId, user, onClose, onPreviewFile }: { invoiceId: string; user: User; onClose: () => void; onPreviewFile: (file: InvoiceFilePreview) => void }) {
  const { data: invoice, isLoading, error } = useQuery({ queryKey: ["invoice-detail", invoiceId], queryFn: () => api<TaxInvoice>(`/api/tax-invoices/${invoiceId}`) });
  const canWork = user.role === "TAX_STAFF" || user.role === "ADMIN";
  const versions = (invoice?.attachments || []).filter((attachment) => attachment.category === "TAX_INVOICE_PDF");
  const activityEvents = (invoice?.events || []).filter((event) => event.event_type.toUpperCase() !== "SUBMITTED");
  return <Modal title="Detail Faktur Pajak" subtitle={invoice?.nsfp || "Detail faktur"} onClose={onClose} size="max-w-5xl">{isLoading ? <LoadingState label="Mengambil detail faktur…" /> : error ? <ErrorBanner message={(error as Error).message} /> : invoice && <div className="space-y-5">
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4"><div><span className="text-xs text-slate-600">Supplier</span><p className="mt-1 font-medium text-slate-900">{invoice.supplier_name}</p></div><div><span className="text-xs text-slate-600">Tanggal faktur</span><p className="mt-1 font-medium text-slate-900">{dateText(invoice.invoice_date)}</p></div><div><span className="text-xs text-slate-600">Masa pajak</span><p className="mt-1 font-medium text-slate-900">{monthText(invoice.tax_period_month)} {invoice.tax_period_year}</p></div><div><span className="text-xs text-slate-600">Status</span><div className="mt-1"><StatusBadge value={["RECEIVED", "UNDER_REVIEW", "VERIFIED"].includes(invoice.lifecycle_status) ? "RECORDED" : invoice.lifecycle_status} /></div></div><div><span className="text-xs text-slate-600">DPP</span><p className="mt-1 font-medium">{money(invoice.dpp_amount)}</p></div><div><span className="text-xs text-slate-600">PPN</span><p className="mt-1 font-medium">{money(invoice.ppn_amount)}</p></div><div><span className="text-xs text-slate-600">Total</span><p className="mt-1 font-semibold">{money(invoice.invoice_total)}</p></div><div><span className="text-xs text-slate-600">Jenis</span><p className="mt-1 font-medium">{invoice.invoice_kind === "REPLACEMENT" ? "Pengganti" : invoice.invoice_kind}</p></div></div>
    <div><h3 className="mb-1 text-sm font-semibold text-slate-900">Barang pembelian yang tercakup</h3><p className="mb-2 text-xs text-slate-500">Rincian barang yang dihubungkan ke faktur pajak ini.</p><div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 uppercase text-slate-600"><tr><th className="px-3 py-2.5">Deskripsi</th><th className="px-3 py-2.5">Barang pembelian</th><th className="px-3 py-2.5 text-right">Qty alokasi</th><th className="px-3 py-2.5 text-right">DPP alokasi</th><th className="px-3 py-2.5 text-right">PPN alokasi</th><th className="px-3 py-2.5 text-right">Total alokasi</th></tr></thead><tbody className="divide-y divide-slate-100">{invoice.lines?.flatMap((line) => (line.allocations || []).map((allocation, i) => <tr key={allocation.id || `${line.id}-${i}`}><td className="px-3 py-2.5">{line.description}</td><td className="px-3 py-2.5 font-medium text-slate-800">{allocation.item_code} · {allocation.item_name}</td><td className="px-3 py-2.5 text-right">{allocation.allocated_quantity ?? "—"}</td><td className="px-3 py-2.5 text-right">{money(allocation.allocated_dpp)}</td><td className="px-3 py-2.5 text-right">{money(allocation.allocated_ppn)}</td><td className="px-3 py-2.5 text-right">{money(allocation.allocated_total)}</td></tr>))}</tbody></table></div></div>
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">File faktur & versi</h3>
        {!!versions.length && <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{versions.length} versi</span>}
      </div>
      {versions.length ? <ol className="space-y-0">{versions.slice().reverse().map((attachment, index) => {
        const version = attachment.version_number || versions.length - index;
        const latest = index === 0;
        const last = index === versions.length - 1;
        const versionStatus = attachment.version_status || (latest ? "ACTIVE" : "SUPERSEDED");
        const revisionReason = attachment.revision_reason || (attachment.supersedes_attachment_id ? "Alasan belum dicatat" : "Unggahan awal");
        return <li key={attachment.id} className={`relative flex gap-3 ${last ? "" : "pb-3"}`}>
          <div className="relative flex w-9 shrink-0 justify-center">
            {!last && <span aria-hidden="true" className="absolute bottom-[-0.75rem] left-1/2 top-8 w-px -translate-x-1/2 bg-slate-200" />}
            <span className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border shadow-sm ${latest ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}><FileText size={16} /></span>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="whitespace-nowrap text-sm font-semibold text-slate-900">{attachment.version_nsfp || invoice.nsfp} - V{version}</p>
                {latest && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Terbaru</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge value={versionStatus} />
                <p className="text-xs text-slate-500">{dateTimeText(attachment.uploaded_at)}{attachment.uploaded_by_name ? ` · Oleh ${attachment.uploaded_by_name}` : ""}</p>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <ReasonQuote className="mt-0" label="Alasan versi" text={revisionReason} />
                {attachment.cancellation_reason && <ReasonQuote className="mt-0" label="Alasan dibatalkan" text={attachment.cancellation_reason} tone="rose" />}
              </div>
            </div>
            {canWork && <Button variant="secondary" className="shrink-0 justify-self-end px-2.5 py-1.5 text-xs sm:col-start-2 sm:row-start-1" onClick={() => onPreviewFile({ id: attachment.id, nsfp: attachment.version_nsfp || invoice.nsfp, original_filename: attachment.original_filename, mime_type: attachment.mime_type, version })}><FileText size={13} />Nota Faktur</Button>}
          </div>
        </li>;
      })}</ol> : <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">Belum ada file faktur.</p>}
    </div>
    <div>
      <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900">Riwayat aktivitas</h3><p className="mt-0.5 text-xs text-slate-500">Perubahan status dan aktivitas faktur.</p></div>{!!activityEvents.length && <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{activityEvents.length} aktivitas</span>}</div>
      {activityEvents.length ? <ol className="space-y-0">{activityEvents.map((event, index) => {
        const type = event.event_type.toUpperCase();
        const presentation = {
          CREATED: { title: "Faktur dibuat", Icon: FileText, tone: "border-blue-200 bg-blue-50 text-blue-700" },
          VERIFIED: { title: "Faktur diverifikasi", Icon: CheckCircle2, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
          CANCELLED: { title: "Faktur dibatalkan", Icon: XCircle, tone: "border-rose-200 bg-rose-50 text-rose-700" },
          REPLACED: { title: "Faktur digantikan", Icon: FileClock, tone: "border-violet-200 bg-violet-50 text-violet-700" },
          DATA_CORRECTED: { title: "Data faktur dikoreksi", Icon: Pencil, tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
          FILE_VERSION_UPLOADED: { title: "Versi file faktur diunggah", Icon: FileUp, tone: "border-violet-200 bg-violet-50 text-violet-700" },
          FILE_VERSION_CANCELLED: { title: "Versi faktur dibatalkan", Icon: XCircle, tone: "border-rose-200 bg-rose-50 text-rose-700" },
          FILE_VERSION_RESTORED: { title: "Versi faktur dipulihkan", Icon: RotateCcw, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
        }[type] || { title: type.replace(/_/g, " ").toLowerCase(), Icon: FileText, tone: "border-slate-200 bg-slate-100 text-slate-600" };
        const { Icon } = presentation;
        const latest = index === 0;
        const last = index === activityEvents.length - 1;
        return <li key={event.id} className={`relative flex gap-3 ${last ? "" : "pb-4"}`}>
          <div className="relative flex w-9 shrink-0 justify-center">
            {!last && <span aria-hidden="true" className="absolute bottom-[-1rem] left-1/2 top-8 w-px -translate-x-1/2 bg-slate-200" />}
            <span className={`relative z-10 grid h-9 w-9 place-items-center rounded-full border shadow-sm ${presentation.tone}`}><Icon size={16} strokeWidth={2} /></span>
          </div>
          <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-slate-900">{presentation.title}</h4>{latest && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Terbaru</span>}</div><p className="mt-1 text-xs text-slate-500">Oleh {event.actor_name}</p>{event.reason && <ReasonQuote label={type === "FILE_VERSION_CANCELLED" ? "Alasan pembatalan" : type === "DATA_CORRECTED" ? "Alasan koreksi" : type === "REPLACED" || type === "FILE_VERSION_RESTORED" ? "Keterangan" : "Alasan"} text={event.reason} tone={type === "FILE_VERSION_CANCELLED" || type === "CANCELLED" ? "rose" : "slate"} />}</div><time className="shrink-0 text-xs text-slate-500 sm:pt-0.5">{dateTimeText(event.event_at)}</time></div>
          </div>
        </li>;
      })}</ol> : <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">Belum ada histori.</p>}
    </div>
  </div>}</Modal>;
}
