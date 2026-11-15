import React from "react";
import { createPortal } from "react-dom";
import { Activity, LoaderCircle, X, type LucideIcon } from "lucide-react";

export function Button({ children, variant = "primary", className = "", loading = false, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "dangerGhost" | "ghost"; loading?: boolean }) {
  const colors = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    dangerGhost: "text-rose-700 hover:bg-rose-50 hover:text-rose-800",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  };
  return <button {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${colors[variant]} ${className}`}>{loading && <LoaderCircle aria-hidden="true" size={15} className="shrink-0 animate-spin motion-reduce:animate-none" />}{children}</button>;
}

export function LoadingState({ label = "Memuat data…", compact = false }: { label?: string; compact?: boolean }) {
  return <div role="status" aria-live="polite" className={`flex items-center justify-center gap-3 text-left ${compact ? "py-5" : "min-h-44 py-10"}`}>
    <span className={`relative grid shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700 ${compact ? "h-10 w-10" : "h-12 w-12"}`}>
      <span aria-hidden="true" className="absolute inset-0 rounded-full border-[3px] border-blue-100 border-t-blue-600 animate-spin motion-reduce:animate-none" />
      <Activity aria-hidden="true" size={compact ? 17 : 20} className="animate-pulse motion-reduce:animate-none" />
    </span>
    <span><span className="block text-sm font-semibold text-slate-800">Sedang memproses</span><span className="mt-0.5 block text-xs text-slate-500">{label}</span></span>
  </div>;
}

export function TableLoadingRow({ columns, label = "Memuat data…" }: { columns: number; label?: string }) {
  return <tr><td colSpan={columns} className="px-4 py-3"><LoadingState label={label} compact /></td></tr>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton-shimmer inline-block rounded-md ${className}`} />;
}

export function AppLoadingScreen() {
  return <main role="status" aria-live="polite" className="flex min-h-screen items-center justify-center bg-[#f4f6f9] px-4">
    <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white px-7 py-8 text-center shadow-card">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><Activity size={27} className="animate-pulse motion-reduce:animate-none" /></span>
      <p className="mt-4 text-sm font-bold tracking-[.16em] text-slate-900">PROCURA</p>
      <p className="mt-1 text-xs text-slate-500">Purchasing Workspace</p>
      <div className="mt-5"><LoadingState label="Menyiapkan workspace Anda…" compact /></div>
    </div>
  </main>;
}

export function AsyncProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return <div role="status" aria-label="Permintaan sedang diproses" className="async-progress fixed inset-x-0 top-0 z-[60] h-1 overflow-hidden bg-blue-100/90" />;
}

export function Modal({ title, subtitle, onClose, children, size = "max-w-3xl" }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; size?: string }) {
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className={`flex max-h-[92vh] w-full ${size} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}>
      <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
        <div><h2 className="text-lg font-semibold text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}</div>
        <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </header>
      <div className="overflow-y-auto p-5 sm:p-6">{children}</div>
    </section>
  </div>, document.body);
}

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700", POSTED: "bg-blue-50 text-blue-700", CANCELLED: "bg-rose-50 text-rose-700",
  REQUIRED: "bg-blue-50 text-blue-700", NOT_REQUIRED: "bg-slate-100 text-slate-600", UNDETERMINED: "bg-orange-50 text-orange-700",
  WAITING: "bg-amber-50 text-amber-700", PARTIAL: "bg-orange-50 text-orange-700", UNDER_REVIEW: "bg-amber-50 text-amber-700",
  NEEDS_REVIEW: "bg-rose-50 text-rose-700", COMPLETE: "bg-emerald-50 text-emerald-700", NOT_REQUIRED_COVERAGE: "bg-slate-100 text-slate-700",
  RECORDED: "bg-blue-50 text-blue-700",
  RECEIVED: "bg-amber-50 text-amber-700", VERIFIED: "bg-emerald-50 text-emerald-700", REPLACED: "bg-slate-100 text-slate-700",
  SUPERSEDED: "bg-slate-100 text-slate-600", FILE_REPLACEMENT_PENDING: "bg-amber-50 text-amber-800",
  ACTIVE: "bg-emerald-50 text-emerald-700", INACTIVE: "bg-slate-100 text-slate-700",
};
const statusLabels: Record<string, string> = {
  DRAFT: "Draft", POSTED: "Diposting", CANCELLED: "Dibatalkan", REQUIRED: "Faktur", NOT_REQUIRED: "Non faktur",
  UNDETERMINED: "Belum ditentukan", WAITING: "Menunggu", PARTIAL: "Sebagian",
  NEEDS_REVIEW: "Perlu pemeriksaan", COMPLETE: "Lengkap", RECEIVED: "Menunggu verifikasi", VERIFIED: "Diverifikasi", REPLACED: "Digantikan", UNDER_REVIEW: "Menunggu verifikasi",
  SUPERSEDED: "Digantikan", FILE_REPLACEMENT_PENDING: "Menunggu faktur pengganti",
  RECORDED: "Tercatat",
  ACTIVE: "Aktif", INACTIVE: "Nonaktif",
};
export function StatusBadge({ value }: { value?: string }) {
  const key = String(value || "NEEDS_REVIEW").toUpperCase();
  const colorKey = key === "NOT_REQUIRED" ? "NOT_REQUIRED_COVERAGE" : key;
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[colorKey] || "bg-slate-100 text-slate-700"}`}>{statusLabels[key] || key.replace(/_/g, " ")}</span>;
}

export function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-700">{eyebrow}</p>}<h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}</div>
    {action}
  </div>;
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex items-start gap-4"><span aria-hidden="true" className="mt-2 h-2 w-8 shrink-0 rounded-full bg-blue-700" /><div><h2 className="text-lg font-semibold text-slate-900">{title}</h2>{description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}</div></div>
    {action}
  </div>;
}

export type SummaryCardData = { label: string; value: React.ReactNode; unit?: string; detail?: React.ReactNode; icon: LucideIcon; tone?: "blue" | "amber" | "violet" | "emerald" | "orange"; loading?: boolean };

export function SummaryCards({ cards, columns = 4, autoFit = false }: { cards: SummaryCardData[]; columns?: 2 | 3 | 4; autoFit?: boolean }) {
  const tones = {
    blue: "bg-blue-600 text-white shadow-blue-100",
    amber: "bg-amber-500 text-white shadow-amber-100",
    violet: "bg-violet-600 text-white shadow-violet-100",
    emerald: "bg-emerald-600 text-white shadow-emerald-100",
    orange: "bg-orange-500 text-white shadow-orange-100",
  };
  const columnClass = columns === 2 ? "sm:grid-cols-2 xl:grid-cols-2" : columns === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4";
  return <div className={`mb-5 grid gap-3 ${autoFit ? "" : columnClass}`} style={autoFit ? { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" } : undefined}>{cards.map((card) => <article key={card.label} className="flex min-h-[88px] min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-card">
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl shadow-sm ${tones[card.tone || "blue"]}`}><card.icon size={20} /></span>
    <div className="min-w-0"><p className="text-xs font-semibold text-slate-600">{card.label}</p><div className="mt-0.5 flex min-h-6 items-center gap-1.5">{card.loading ? <Skeleton className="h-4 w-10" /> : <><span className="truncate text-lg font-bold leading-6 text-slate-900">{card.value}</span>{card.unit && <span className="shrink-0 text-xs text-slate-500">{card.unit}</span>}</>}</div><p className="truncate text-[11px] text-slate-500">{card.loading ? <Skeleton className="h-3 w-28" /> : card.detail}</p></div>
  </article>)}</div>;
}

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-600">*</span>}</span>{children}{hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}</label>;
}

export const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center"><p className="font-semibold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-600">{description}</p></div>;
}

export function ErrorBanner({ message }: { message?: string | null }) {
  return message ? <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{message}</div> : null;
}
