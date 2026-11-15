import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, FileCheck2, FileWarning, ReceiptText, ShoppingBag, TrendingUp } from "lucide-react";
import { api, dateText, money } from "../lib/api";
import { PageResult, PurchaseDocument, User } from "../types";
import { Button, EmptyState, LoadingState, SectionHeading, StatusBadge, SummaryCards } from "./common";

type Props = { user: User; onNavigate: (page: string) => void };
type Summary = { purchase_documents_this_month: number; purchase_value_this_month: number; invoice_status_counts: Record<string, number>; pending_items: number; partial_items: number; needs_review_items: number };

export function DashboardPage({ user, onNavigate }: Props) {
  const { data: summary, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Summary>("/api/dashboard-summary") });
  const { data: purchases, isLoading: purchasesLoading } = useQuery({ queryKey: ["dashboard-purchases"], queryFn: () => api<PageResult<PurchaseDocument>>("/api/purchase-documents?page=1&pageSize=6") });
  const canTax = user.role === "TAX_STAFF" || user.role === "ADMIN";
  const cards = user.role === "PURCHASING" ? [
    { label: "Dokumen pembelian bulan ini", value: summary?.purchase_documents_this_month ?? 0, unit: "dokumen", icon: ShoppingBag, tone: "blue" as const, detail: "Dokumen berstatus diposting", loading: isLoading },
    { label: "Nilai pembelian bulan ini", value: money(summary?.purchase_value_this_month), icon: TrendingUp, tone: "emerald" as const, detail: "Berdasarkan tanggal pembelian", loading: isLoading },
    { label: "Barang menunggu faktur", value: summary?.pending_items ?? 0, unit: "barang", icon: FileWarning, tone: "amber" as const, detail: "Perlu ditindaklanjuti Staff Pajak", loading: isLoading },
    { label: "Faktur terverifikasi bulan ini", value: summary?.invoice_status_counts?.VERIFIED ?? 0, unit: "faktur", icon: FileCheck2, tone: "violet" as const, detail: "Status lifecycle faktur", loading: isLoading },
  ] : [
    { label: "Barang dalam antrean", value: summary?.pending_items ?? 0, unit: "barang", icon: FileWarning, tone: "amber" as const, detail: "Menunggu, sebagian, atau perlu review", loading: isLoading },
    { label: "Barang tercakup sebagian", value: summary?.partial_items ?? 0, unit: "barang", icon: ClipboardList, tone: "orange" as const, detail: "Masih memiliki sisa cakupan", loading: isLoading },
    { label: "Perlu pemeriksaan", value: summary?.needs_review_items ?? 0, unit: "barang", icon: FileWarning, tone: "violet" as const, detail: "Basis atau target perlu dipastikan", loading: isLoading },
    { label: "Faktur terverifikasi bulan ini", value: summary?.invoice_status_counts?.VERIFIED ?? 0, unit: "faktur", icon: FileCheck2, tone: "emerald" as const, detail: "Status lifecycle faktur", loading: isLoading },
  ];
  return <div><SectionHeading title={`Selamat datang, ${user.name.split(" ")[0]}`} description="Ringkasan operasional pembelian dan faktur untuk periode berjalan." action={user.role === "PURCHASING" || user.role === "ADMIN" ? <Button onClick={() => onNavigate("purchases")}><ShoppingBag size={16} />Buka Pembelian</Button> : <Button onClick={() => onNavigate("invoices")}><ReceiptText size={16} />Buka Faktur Pajak</Button>} />
    <SummaryCards cards={cards} />
    <div className="grid gap-4 lg:grid-cols-[1.4fr_.8fr]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="font-semibold text-slate-900">Pembelian terbaru</h2><p className="text-xs text-slate-600">Dokumen dengan aktivitas terakhir</p></div><button onClick={() => onNavigate("purchases")} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800">Lihat semua <ArrowRight size={15} /></button></div>
        {purchasesLoading ? <div className="px-4"><LoadingState label="Mengambil transaksi terbaru…" compact /></div> : !purchases?.data.length ? <div className="p-4"><EmptyState title="Belum ada transaksi" description="Transaksi yang diposting akan muncul di sini." /></div> : <div className="divide-y divide-slate-100">{purchases.data.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{doc.supplier_name}</p><p className="mt-0.5 truncate text-xs text-slate-600">{doc.purchase_group_code} · {dateText(doc.purchase_date)} · {doc.item_count} barang</p></div><div className="shrink-0 text-right"><p className="text-sm font-medium tabular-nums text-slate-900">{money(doc.total_amount)}</p><span className="mt-1 inline-block"><StatusBadge value={doc.record_status} /></span></div></div>)}</div>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><ReceiptText size={20} /></span><h2 className="mt-4 text-lg font-semibold text-slate-900">Alur kerja hari ini</h2><p className="mt-1 text-sm leading-6 text-slate-600">Pisahkan periode pembelian dan periode faktur. Status kelengkapan berubah setelah alokasi faktur aktif diverifikasi.</p><div className="mt-4 space-y-2">{[
        { label: "Catat transaksi pembelian", page: "purchases", show: user.role !== "TAX_STAFF" },
        { label: "Kelola antrean & riwayat faktur", page: "invoices", show: canTax },
        { label: "Lihat laporan periode", page: "reports", show: true },
      ].filter((item) => item.show).map((item) => <button key={item.page} onClick={() => onNavigate(item.page)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:border-blue-200 hover:bg-blue-50/50"><span>{item.label}</span><ArrowRight size={15} className="text-slate-400" /></button>)}</div></section>
    </div>
  </div>;
}
