import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardList, FileCheck2, ReceiptText, ShoppingBag, TrendingUp } from "lucide-react";
import { api, money, monthText } from "../lib/api";
import { User } from "../types";
import { Button, EmptyState, ErrorBanner, LoadingState, SectionHeading, SummaryCards } from "./common";

type Props = { user: User; onNavigate: (page: string) => void };
type Summary = { purchase_documents_this_month: number; purchase_value_this_month: number };
type MonthlyPurchase = { month: number; invoice_total: number; non_invoice_total: number; unclassified_total: number; ppn_total: number; purchase_total: number };
type ProjectPurchase = { project_id: string | null; project_name: string; monthly_totals: number[]; annual_total: number };
type PurchaseAnalytics = { year: number; months: MonthlyPurchase[]; projects: ProjectPurchase[] };
type MonthlyValueKey = "invoice_total" | "non_invoice_total" | "unclassified_total" | "ppn_total";
type ChartSeries = { key: MonthlyValueKey; label: string; color: string };
type PieDatum = { label: string; value: number; color: string };

const monthNames = Array.from({ length: 12 }, (_, index) => {
  const label = monthText(index + 1);
  return `${label.charAt(0).toLocaleUpperCase("id-ID")}${label.slice(1)}`;
});
const rupiahNumber = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

function compactRupiah(value: number) {
  const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return `Rp ${compact}`;
}

function RupiahCell({ value }: { value: number }) {
  return <span className="flex w-full items-center justify-between gap-2 tabular-nums">
    <span className="text-slate-500">Rp</span>
    <span className="text-right">{rupiahNumber.format(Number(value || 0))}</span>
  </span>;
}

function percentageText(value: number, total: number) {
  const percentage = total > 0 ? value / total * 100 : 0;
  return `${percentage > 0 && percentage < 1 ? percentage.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : Math.round(percentage)}%`;
}

function MonthlyAmountCard({ title, amounts, total }: { title: string; amounts: number[]; total: number }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
    <div className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[250px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr><th className="px-4 py-2.5">Bulan</th><th className="px-4 py-2.5 text-right">Nominal</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {monthNames.map((monthName, index) => <tr key={monthName} className="hover:bg-slate-50/60">
            <td className="px-4 py-2 font-medium text-slate-800">{monthName}</td>
            <td className="whitespace-nowrap px-4 py-2"><RupiahCell value={amounts[index] || 0} /></td>
          </tr>)}
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
            <td className="px-4 py-3">Total</td>
            <td className="whitespace-nowrap px-4 py-3"><RupiahCell value={total} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>;
}

function CategoryPieCard({ data, year }: { data: PieDatum[]; year: number }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let progress = 0;
  const gradientStops = data.map((item) => {
    const start = progress;
    progress += total > 0 ? item.value / total * 100 : 0;
    return `${item.color} ${start}% ${progress}%`;
  });
  const donutBackground = total > 0 ? `conic-gradient(${gradientStops.join(", ")})` : "#e2e8f0";

  return <section className="min-w-0 self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
    <div className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-base font-semibold text-slate-900">Perbandingan kategori</h3>
      <p className="mt-0.5 text-sm text-slate-500">Nominal tiap kategori pada tahun berjalan.</p>
    </div>
    <div className="flex flex-col items-center gap-3 p-4">
      <div role="img" aria-label={`Perbandingan kategori tahun ${year}`} className="relative h-40 w-40 shrink-0 rounded-full" style={{ background: donutBackground }}>
        <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white text-center">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total {year}</span>
          <span className="mt-1 whitespace-nowrap text-base font-bold tabular-nums text-slate-900">Rp {rupiahNumber.format(total)}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {data.map((item) => <li key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <div className="flex items-center gap-2 text-[13px]">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-700">{item.label}</span>
            <span className="font-semibold tabular-nums text-slate-700">{percentageText(item.value, total)}</span>
          </div>
          <div className="mt-1 pl-5 text-[13px] font-medium"><RupiahCell value={item.value} /></div>
        </li>)}
      </ul>
    </div>
  </section>;
}

function MonthlyBarChart({ title, description, months, series }: { title: string; description: string; months: MonthlyPurchase[]; series: ChartSeries[] }) {
  const width = 960;
  const height = 300;
  const margin = { top: 20, right: 20, bottom: 42, left: 82 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(0, ...months.flatMap((month) => series.map((item) => Number(month[item.key] || 0))));
  const safeMax = maxValue || 1;
  const groupWidth = chartWidth / 12;
  const barGap = series.length > 2 ? 2 : 4;
  const barWidth = Math.max(4, Math.min(22, (groupWidth * 0.68 - barGap * (series.length - 1)) / series.length));
  const barsWidth = barWidth * series.length + barGap * (series.length - 1);

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><BarChart3 size={18} /></span>
      <div><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-0.5 text-xs text-slate-500">{description}</p></div>
    </div>
    <div className="overflow-x-auto px-3 pt-3">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="h-[260px] w-full min-w-[720px]">
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = safeMax * tick / 4;
          const y = margin.top + chartHeight - chartHeight * tick / 4;
          return <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={tick === 0 ? undefined : "3 4"} />
            <text x={margin.left - 9} y={y + 4} textAnchor="end" fill="#64748b" fontSize="11">{compactRupiah(value)}</text>
          </g>;
        })}
        {monthNames.map((monthName, monthIndex) => {
          const month = months[monthIndex];
          const center = margin.left + groupWidth * monthIndex + groupWidth / 2;
          const startX = center - barsWidth / 2;
          return <g key={monthName}>
            {series.map((item, seriesIndex) => {
              const value = Number(month?.[item.key] || 0);
              const barHeight = chartHeight * value / safeMax;
              const x = startX + seriesIndex * (barWidth + barGap);
              const y = margin.top + chartHeight - barHeight;
              return <rect key={item.key} x={x} y={y} width={barWidth} height={barHeight} rx="3" fill={item.color}>
                <title>{`${monthName} · ${item.label}: ${money(value)}`}</title>
              </rect>;
            })}
            <text x={center} y={height - 14} textAnchor="middle" fill="#64748b" fontSize="11">{monthName.slice(0, 3)}</text>
          </g>;
        })}
      </svg>
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 pb-4 pt-1">
      {series.map((item) => <span key={item.key} className="inline-flex items-center gap-2 text-xs text-slate-600"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />{item.label}</span>)}
    </div>
  </section>;
}

export function DashboardPage({ user, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const currentMonthIndex = new Date().getMonth();
  const { data: summary, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Summary>("/api/dashboard-summary") });
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useQuery({
    queryKey: ["dashboard-purchase-analytics", currentYear],
    queryFn: () => api<PurchaseAnalytics>(`/api/dashboard-purchase-analytics?year=${currentYear}`),
  });
  const months = analytics?.months || [];
  const currentMonth = months[currentMonthIndex];
  const projects = analytics?.projects || [];
  const hasUnclassified = months.some((month) => month.unclassified_total > 0);
  const totals = months.reduce((acc, month) => ({
    invoice_total: acc.invoice_total + month.invoice_total,
    non_invoice_total: acc.non_invoice_total + month.non_invoice_total,
    unclassified_total: acc.unclassified_total + month.unclassified_total,
    ppn_total: acc.ppn_total + month.ppn_total,
    purchase_total: acc.purchase_total + month.purchase_total,
  }), { invoice_total: 0, non_invoice_total: 0, unclassified_total: 0, ppn_total: 0, purchase_total: 0 });
  const monthlySeries: ChartSeries[] = [
    { key: "invoice_total", label: "Faktur", color: "#2563eb" },
    { key: "non_invoice_total", label: "Non Faktur", color: "#059669" },
    ...(hasUnclassified ? [{ key: "unclassified_total" as const, label: "Belum ditetapkan", color: "#94a3b8" }] : []),
  ];
  const summaryCardsLoading = isLoading || analyticsLoading;
  const cards = [
    { label: "Pembelian bulan ini", value: analytics ? money(currentMonth?.purchase_total ?? 0) : "—", icon: ShoppingBag, tone: "blue" as const, detail: summary ? `${summary.purchase_documents_this_month} dokumen` : "Total transaksi" , loading: summaryCardsLoading },
    { label: "Pembelian faktur bulan ini", value: analytics ? money(currentMonth?.invoice_total ?? 0) : "—", icon: FileCheck2, tone: "emerald" as const, detail: "Dengan faktur pajak", loading: summaryCardsLoading },
    { label: "Pembelian non faktur bulan ini", value: analytics ? money(currentMonth?.non_invoice_total ?? 0) : "—", icon: ClipboardList, tone: "orange" as const, detail: "Tanpa faktur pajak", loading: summaryCardsLoading },
    { label: "PPN bulan ini", value: analytics ? money(currentMonth?.ppn_total ?? 0) : "—", icon: TrendingUp, tone: "violet" as const, detail: "PPN pembelian", loading: summaryCardsLoading },
  ];

  return <div><SectionHeading title={`Selamat datang, ${user.name.split(" ")[0]}`} description="Ringkasan operasional pembelian dan faktur untuk periode berjalan." action={user.role === "PURCHASING" || user.role === "ADMIN" ? <Button onClick={() => onNavigate("purchases")}><ShoppingBag size={16} />Buka Pembelian</Button> : <Button onClick={() => onNavigate("invoices")}><ReceiptText size={16} />Buka Faktur Pajak</Button>} />
    <SummaryCards cards={cards} />

    <section className="mb-5 space-y-4">
      <div><h2 className="text-lg font-semibold text-slate-900">Rekap pembelian bulanan</h2><p className="mt-1 text-sm text-slate-600">Tahun {analytics?.year ?? currentYear} · Nilai pembelian termasuk PPN.</p></div>
      <ErrorBanner message={analyticsError instanceof Error ? analyticsError.message : null} />
      {analyticsLoading ? <div className="rounded-2xl border border-slate-200 bg-white"><LoadingState label="Menghitung rekap bulanan dan project…" /></div> : analytics && <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MonthlyAmountCard title="Pembelian Faktur" amounts={months.map((month) => month.invoice_total)} total={totals.invoice_total} />
          <MonthlyAmountCard title="Pembelian Non Faktur" amounts={months.map((month) => month.non_invoice_total)} total={totals.non_invoice_total} />
          <MonthlyAmountCard title="PPN" amounts={months.map((month) => month.ppn_total)} total={totals.ppn_total} />
          <CategoryPieCard year={analytics?.year ?? currentYear} data={[
            { label: "Pembelian Faktur", value: totals.invoice_total, color: "#2563eb" },
            { label: "Pembelian Non Faktur", value: totals.non_invoice_total, color: "#059669" },
            { label: "PPN", value: totals.ppn_total, color: "#7c3aed" },
          ]} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <MonthlyBarChart title="Faktur vs Non Faktur" description="Nominal pembelian per bulan." months={months} series={monthlySeries} />
          <MonthlyBarChart title="PPN per bulan" description="PPN yang tercatat pada transaksi pembelian." months={months} series={[{ key: "ppn_total", label: "PPN", color: "#7c3aed" }]} />
        </div>

        <section className="space-y-4">
          <div><h3 className="text-base font-semibold text-slate-900">Pembelian per project</h3><p className="mt-1 text-sm text-slate-600">Setiap project memiliki rekap bulanan sendiri.</p></div>
          {!projects.length ? <div className="rounded-2xl border border-slate-200 bg-white p-4"><EmptyState title="Belum ada project aktif" description="Kartu project akan muncul setelah project ditambahkan." /></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {projects.map((project) => <MonthlyAmountCard key={project.project_id || "no-project"} title={project.project_name} amounts={project.monthly_totals} total={project.annual_total} />)}
          </div>}
        </section>
      </>}
    </section>
  </div>;
}
