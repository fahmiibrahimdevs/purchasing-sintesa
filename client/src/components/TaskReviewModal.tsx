import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Calendar, CheckCircle2, Clock, FileWarning, Hourglass, Package, ReceiptText } from "lucide-react";
import { api, dateText, money, quantityText } from "../lib/api";
import { PageResult, PurchaseItem, TaxInvoice } from "../types";
import { Button, EmptyState, LoadingState, Modal, StatusBadge } from "./common";

export type TaskReviewType = "pending" | "missing_file" | "replacement_pending" | "verified";

type Props = {
  type: TaskReviewType | null;
  onClose: () => void;
  onSelectTarget: (page: string, params: { q?: string; highlightId?: string }) => void;
};

const modalConfig: Record<TaskReviewType, { title: string; subtitle: string; emptyTitle: string; emptyDesc: string }> = {
  pending: {
    title: "Barang belum ada faktur",
    subtitle: "Daftar barang pembelian yang belum memiliki faktur pajak.",
    emptyTitle: "Tidak ada barang menunggu faktur",
    emptyDesc: "Semua barang pembelian yang memerlukan faktur sudah terhubung ke faktur pajak.",
  },
  missing_file: {
    title: "Faktur belum ada lampiran",
    subtitle: "Daftar faktur pajak yang belum memiliki file PDF atau foto resmi.",
    emptyTitle: "Semua faktur lengkap",
    emptyDesc: "Semua faktur pajak yang tercatat sudah memiliki file lampiran.",
  },
  replacement_pending: {
    title: "Menunggu faktur pengganti",
    subtitle: "Daftar faktur pajak yang dibatalkan atau menunggu faktur pengganti dari supplier.",
    emptyTitle: "Tidak ada faktur menunggu pengganti",
    emptyDesc: "Tidak ada faktur pajak yang sedang menunggu revisi atau penggantian saat ini.",
  },
  verified: {
    title: "Faktur tercatat bulan ini",
    subtitle: "Daftar faktur pajak yang sudah selesai diinput untuk transaksi pembelian.",
    emptyTitle: "Belum ada faktur tercatat",
    emptyDesc: "Belum ada faktur pajak yang dicatat untuk periode ini.",
  },
};

export function TaskReviewModal({ type, onClose, onSelectTarget }: Props) {
  if (!type) return null;

  const config = modalConfig[type];

  // Fetch purchase items for pending task review
  const isInvoiceQuery = type === "verified" || type === "missing_file" || type === "replacement_pending";
  const { data: purchaseItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["invoice-items", "task-modal"],
    queryFn: () => api<PurchaseItem[]>("/api/purchase-items/invoice-items"),
    enabled: !isInvoiceQuery,
  });

  // Fetch tax invoices for invoice-related reviews
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ["tax-invoices-task-modal"],
    queryFn: () => api<PageResult<TaxInvoice>>("/api/tax-invoices?pageSize=100"),
    enabled: isInvoiceQuery,
  });

  const isLoading = isInvoiceQuery ? invoicesLoading : itemsLoading;

  // Filter purchase items based on type
  const filteredItems = useMemo(() => {
    if (isInvoiceQuery) return [];
    if (type === "pending") {
      return purchaseItems.filter(
        (item) =>
          item.invoice_requirement !== "NOT_REQUIRED" &&
          item.coverage_status === "WAITING"
      );
    }
    return [];
  }, [purchaseItems, type, isInvoiceQuery]);

  const targetInvoices = useMemo(() => {
    if (!isInvoiceQuery) return [];
    const all = invoicesData?.data || [];
    if (type === "verified") {
      return all.filter((inv) => inv.lifecycle_status === "VERIFIED");
    }
    if (type === "missing_file") {
      return all.filter(
        (inv) =>
          !["CANCELLED", "REPLACED"].includes(inv.lifecycle_status) &&
          !inv.latest_attachment_id
      );
    }
    if (type === "replacement_pending") {
      return all.filter(
        (inv) =>
          inv.lifecycle_status === "CANCELLED" || Boolean(inv.file_replacement_pending)
      );
    }
    return [];
  }, [invoicesData, isInvoiceQuery, type]);

  const totalCount = isInvoiceQuery ? targetInvoices.length : filteredItems.length;
  const totalAmount = isInvoiceQuery
    ? targetInvoices.reduce((sum, inv) => sum + Number(inv.invoice_total || 0), 0)
    : filteredItems.reduce(
        (sum, item) => sum + Number(item.purchase_total || item.purchase_subtotal || 0),
        0
      );

  return (
    <Modal title={config.title} subtitle={config.subtitle} onClose={onClose} size="max-w-2xl">
      <div className="space-y-4">
        {isLoading ? (
          <LoadingState label="Mengambil data tinjauan…" />
        ) : totalCount === 0 ? (
          <EmptyState title={config.emptyTitle} description={config.emptyDesc} />
        ) : (
          <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
            {isInvoiceQuery
              ? targetInvoices.map((inv) => {
                  const initial = (inv.supplier_name || "S").trim().charAt(0).toUpperCase();
                  return (
                    <article
                      key={inv.id}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm transition hover:border-blue-400 hover:bg-slate-50/60"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-sm font-bold text-blue-700">
                          {initial}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-sm font-semibold text-slate-900">
                              {inv.supplier_name}
                            </h4>
                            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                              {inv.nsfp}
                            </span>
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center text-xs text-slate-600">
                            <span>{dateText(inv.invoice_date)}</span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>{inv.lines?.length || 1} baris</span>
                            {type === "missing_file" && (
                              <>
                                <span className="mx-1.5 text-slate-300">·</span>
                                <span className="inline-flex items-center gap-1 font-medium text-rose-600">
                                  <FileWarning size={12} /> Belum ada file
                                </span>
                              </>
                            )}
                            {type === "replacement_pending" && (
                              <>
                                <span className="mx-1.5 text-slate-300">·</span>
                                <span className="inline-flex items-center gap-1 font-medium text-violet-600">
                                  <Clock size={12} /> Menunggu pengganti
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-slate-900">
                            {money(inv.invoice_total)}
                          </p>
                          <p className="text-[10px] font-medium text-emerald-700">
                            PPN: {money(inv.ppn_amount)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onSelectTarget("invoices", {
                              q: inv.nsfp,
                              highlightId: `invoice-${inv.id}`,
                            });
                          }}
                          className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-blue-500 hover:bg-blue-600 hover:text-white"
                          title="Buka dan sorot faktur ini"
                          aria-label={`Buka faktur ${inv.nsfp}`}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })
              : filteredItems.map((item) => {
                  const initial = (item.supplier_name || "P").trim().charAt(0).toUpperCase();
                  return (
                    <article
                      key={item.id}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm transition hover:border-blue-400 hover:bg-slate-50/60"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-sm font-bold text-blue-700">
                          {initial}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="truncate text-sm font-semibold text-slate-900">
                              {item.item_name}
                            </h4>
                            {item.project_name && (
                              <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                                {item.project_name}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-600">
                            <span>{item.supplier_name || "Supplier"}</span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>{quantityText(item.quantity)} {item.uom}</span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>{dateText(item.purchase_date)}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-slate-900">
                            {money(item.purchase_total || item.purchase_subtotal)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onSelectTarget("invoices", {
                              q: item.purchase_group_code || item.item_code,
                              highlightId: `item-${item.id}`,
                            });
                          }}
                          className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-blue-500 hover:bg-blue-600 hover:text-white"
                          title="Buka dan sorot barang ini di Faktur Pajak"
                          aria-label={`Buka barang ${item.item_name}`}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
          </div>
        )}

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="text-sm text-slate-600">
            Total: <strong className="font-bold text-slate-900">{totalCount}</strong>{" "}
            {isInvoiceQuery ? "faktur" : "barang"} (
            <span className="font-semibold text-blue-700">{money(totalAmount)}</span>)
          </div>
          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
