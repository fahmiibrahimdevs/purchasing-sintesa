import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Building2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FolderKanban, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { api, dateTimeText, jsonBody } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { confirmAction } from "../lib/swal";
import { PageResult, Project, Supplier, User } from "../types";
import { Button, EmptyState, ErrorBanner, Field, inputClass, LoadingState, Modal, SectionHeading, StatusBadge, SummaryCards, TableLoadingRow } from "./common";

type Props = { user: User; notify: (message: string, kind?: "success" | "error") => void };
type AuditRow = { id: string; action: string; entity_type: string; entity_id?: string; user_name?: string; created_at: string; reason?: string };

export function SettingsPage({ user, notify }: Props) {
  const [tab, setTab] = useState("users");
  const { data: users = [], isLoading: usersLoading } = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users"), enabled: user.role === "ADMIN" });
  const { data: audit, isLoading: auditLoading } = useQuery({ queryKey: ["settings-audit-count"], queryFn: () => api<PageResult<AuditRow>>("/api/reports/audit?page=1&pageSize=1"), enabled: user.role === "ADMIN" });
  if (user.role !== "ADMIN") return <EmptyState title="Akses dibatasi" description="Pengaturan master dan pengguna hanya dapat dikelola Admin." />;
  return <div><SectionHeading title="Pengaturan" description="Kelola akun pengguna dan jejak aktivitas aplikasi." />
    <SummaryCards cards={[
      { label: "Pengguna terdaftar", value: users.length, unit: "akun", detail: `${users.filter((account: any) => account.is_active).length} akun aktif`, icon: UsersRound, tone: "emerald", loading: usersLoading },
      { label: "Aktivitas tercatat", value: audit?.total ?? 0, unit: "aktivitas", detail: "Seluruh jejak audit aplikasi", icon: ShieldCheck, tone: "amber", loading: auditLoading },
    ]} columns={2} />
    <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-card">{[
      ["users", "Pengguna", UsersRound], ["audit", "Audit log", ShieldCheck],
    ].map(([key, label, Icon]: any) => <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold ${tab === key ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={16} />{label}</button>)}</div>
    {tab === "users" && <UserSettings currentUser={user} notify={notify} />}{tab === "audit" && <AuditSettings />}
  </div>;
}

export function MasterDataPage({ section, user, notify }: { section: "suppliers" | "projects"; user: User; notify: Props["notify"] }) {
  const isSupplier = section === "suppliers";
  return <div><SectionHeading title={isSupplier ? "Supplier" : "Project"} description={isSupplier ? "Kelola daftar pemasok untuk transaksi pembelian." : "Kelola daftar project untuk pengelompokan barang pembelian."} />
    {isSupplier ? <SupplierSettings user={user} notify={notify} /> : <ProjectSettings user={user} notify={notify} />}
  </div>;
}

const pageSizes = [10, 25, 50, 100];
type ListToolbarProps = { search: string; onSearch: (value: string) => void; pageSize: number; onPageSize: (value: number) => void; placeholder: string };
function ListToolbar({ search, onSearch, pageSize, onPageSize, placeholder }: ListToolbarProps) {
  return <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-center gap-2 text-sm text-slate-600">Tampilkan <select aria-label="Jumlah data per halaman" className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select> entri</label><label className="flex items-center gap-2 text-sm text-slate-600">Cari <span className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} min-w-0 py-2 pl-9 sm:w-72`} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} /></span></label></div>;
}
function ListPagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  const visibleCount = Math.min(5, pageCount);
  const start = Math.min(Math.max(1, page - 2), pageCount - visibleCount + 1);
  const pages = Array.from({ length: visibleCount }, (_, index) => start + index);
  const iconButton = "grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white";
  return <footer className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between"><span>Menampilkan {first}–{last} dari {total} data</span><nav aria-label="Pagination" className="flex items-center gap-1"><button type="button" aria-label="Halaman pertama" title="Halaman pertama" className={iconButton} disabled={page <= 1} onClick={() => onPage(1)}><ChevronsLeft size={16} /></button><button type="button" aria-label="Halaman sebelumnya" title="Halaman sebelumnya" className={iconButton} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>{pages.map((entry) => <button key={entry} type="button" aria-label={`Halaman ${entry}`} aria-current={entry === page ? "page" : undefined} onClick={() => onPage(entry)} className={`grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-sm font-medium transition ${entry === page ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{entry}</button>)}<button type="button" aria-label="Halaman berikutnya" title="Halaman berikutnya" className={iconButton} disabled={page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button><button type="button" aria-label="Halaman terakhir" title="Halaman terakhir" className={iconButton} disabled={page >= pageCount} onClick={() => onPage(pageCount)}><ChevronsRight size={16} /></button></nav></footer>;
}
function FloatingAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"><Plus size={23} /></button>;
}

function RelationCount({ value, noun = "pembelian" }: { value?: number | string; noun?: string }) {
  const count = Number(value || 0);
  return <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{count} {noun}</span>;
}

function MasterAction({ isActive, relatedCount, working, self, label, onArchive, onRestore, onDelete }: { isActive: boolean; relatedCount?: number | string; working: boolean; self?: boolean; label: string; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
  const linked = Number(relatedCount || 0) > 0;
  if (self) return <span className="text-xs text-slate-400">Akun aktif</span>;
  if (!isActive) return <div className="flex justify-end gap-1.5"><Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onRestore}><RotateCcw size={13} />Pulihkan</Button>{!linked && <Button variant="dangerGhost" className="px-2.5 py-1.5 text-xs" loading={working} onClick={onDelete}><Trash2 size={13} />Hapus</Button>}</div>;
  return <Button variant={linked ? "secondary" : "dangerGhost"} className="px-2.5 py-1.5 text-xs" loading={working} onClick={linked ? onArchive : onDelete} title={linked ? `${label} dipakai di ${Number(relatedCount)} data terkait; arsipkan agar riwayat tetap utuh.` : `${label} tidak memiliki data terkait dan bisa dihapus permanen.`}>{linked ? <><Archive size={13} />Arsipkan</> : <><Trash2 size={13} />Hapus</>}</Button>;
}

function SupplierSettings({ user, notify }: { user: User; notify: Props["notify"] }) {
  const queryClient = useQueryClient();
  const canManage = user.role === "PURCHASING" || user.role === "ADMIN";
  const [search, setSearch] = useState(""); const [pageSize, setPageSize] = useState(25); const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 500);
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [defaultInvoiceRequirement, setDefaultInvoiceRequirement] = useState<"REQUIRED" | "NOT_REQUIRED">("REQUIRED"); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [workingId, setWorkingId] = useState<string | null>(null);
  const { data: suppliers = [], isLoading } = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/api/suppliers") });
  const filtered = suppliers.filter((supplier) => `${supplier.supplier_code} ${supplier.name} ${supplier.is_active ? "aktif" : "nonaktif"} ${supplier.default_invoice_requirement === "NOT_REQUIRED" ? "non faktur" : "faktur"}`.toLocaleLowerCase().includes(debouncedSearch.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const currentPage = Math.min(page, pageCount); const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function openAdd() { if (!canManage) return; setEditing(null); setName(""); setCode(""); setDefaultInvoiceRequirement("REQUIRED"); setError(""); setFormOpen(true); }
  function openEdit(supplier: Supplier) { if (!canManage) return; setEditing(supplier); setName(supplier.name); setCode(supplier.supplier_code); setDefaultInvoiceRequirement(supplier.default_invoice_requirement || "REQUIRED"); setError(""); setFormOpen(true); }
  async function save() { if (!canManage) return; setSaving(true); setError(""); try { const body = { name: name.trim(), supplier_code: code.trim() || undefined, default_invoice_requirement: defaultInvoiceRequirement }; await api(editing ? `/api/suppliers/${editing.id}` : "/api/suppliers", { method: editing ? "PUT" : "POST", body: jsonBody(body) }); await queryClient.invalidateQueries({ queryKey: ["suppliers"] }); await queryClient.invalidateQueries({ queryKey: ["purchases"] }); setFormOpen(false); notify(editing ? "Supplier diperbarui." : "Supplier ditambahkan.", "success"); } catch (e: any) { setError(e.message); } finally { setSaving(false); } }
  async function toggleDefaultInvoiceRequirement(supplier: Supplier) {
    if (!canManage || workingId) return;
    const next = supplier.default_invoice_requirement === "NOT_REQUIRED" ? "REQUIRED" : "NOT_REQUIRED";
    setWorkingId(supplier.id);
    try {
      await api(`/api/suppliers/${supplier.id}`, { method: "PUT", body: jsonBody({ default_invoice_requirement: next }) });
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      notify(`Nilai awal faktur ${supplier.name} diubah menjadi ${next === "REQUIRED" ? "Faktur" : "Non-Faktur"}.`, "success");
    } catch (e: any) { notify(e.message, "error"); }
    finally { setWorkingId(null); }
  }
  async function runAction(supplier: Supplier, action: "archive" | "restore" | "delete") {
    if (!canManage) return;
    const linked = Number(supplier.related_count || 0) > 0;
    const copy = action === "archive"
      ? { title: `Arsipkan supplier ${supplier.name}?`, text: "Supplier tidak akan tersedia untuk transaksi baru. Riwayat pembelian dan faktur tetap utuh.", confirmButtonText: "Ya, Arsipkan", danger: false }
      : action === "restore"
        ? { title: `Pulihkan supplier ${supplier.name}?`, text: "Supplier akan tersedia kembali untuk transaksi baru.", confirmButtonText: "Ya, Pulihkan", danger: false }
        : { title: `Hapus supplier ${supplier.name} permanen?`, text: "Supplier ini tidak memiliki pembelian atau faktur terkait. Penghapusan tidak dapat dibatalkan.", confirmButtonText: "Ya, Hapus", danger: true };
    if (!(await confirmAction(copy))) return;
    setWorkingId(supplier.id);
    try {
      if (action === "delete") await api(`/api/suppliers/${supplier.id}`, { method: "DELETE" });
      else await api(`/api/suppliers/${supplier.id}`, { method: "PUT", body: jsonBody({ is_active: action === "restore" ? 1 : 0 }) });
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      notify(action === "archive" ? "Supplier diarsipkan; riwayat tetap tersimpan." : action === "restore" ? "Supplier dipulihkan." : "Supplier dihapus.", "success");
    } catch (e: any) { notify(e.message, "error"); }
    finally { setWorkingId(null); }
  }
  return <>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Master supplier</div><ListToolbar search={search} onSearch={(value) => { setSearch(value); setPage(1); }} pageSize={pageSize} onPageSize={(value) => { setPageSize(value); setPage(1); }} placeholder="Cari kode atau nama supplier…" /><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Kode</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Status awal</th><th className="px-4 py-3">Pembelian terkait</th><th className="px-4 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{isLoading ? <TableLoadingRow columns={5} label="Mengambil master supplier…" /> : visible.length ? visible.map((supplier) => { const invoiceRequired = supplier.default_invoice_requirement !== "NOT_REQUIRED"; return <tr key={supplier.id} className={`hover:bg-slate-50/70 ${supplier.is_active ? "" : "bg-slate-50/60"}`}><td className="px-4 py-3 font-medium text-slate-700">{supplier.supplier_code}</td><td className="px-4 py-3 text-slate-900"><div className="flex flex-wrap items-center gap-2"><span>{supplier.name}</span>{!supplier.is_active && <StatusBadge value="INACTIVE" />}</div></td><td className="px-4 py-3"><button type="button" role="switch" aria-checked={invoiceRequired} aria-label={`Nilai awal faktur ${supplier.name}: ${invoiceRequired ? "Faktur" : "Non-Faktur"}`} title="Nilai awal untuk toggle faktur pada barang pembelian baru" disabled={Boolean(workingId) || !supplier.is_active} onClick={() => void toggleDefaultInvoiceRequirement(supplier)} className="inline-flex items-center gap-2.5 rounded-lg py-1 pr-2 text-left disabled:cursor-not-allowed disabled:opacity-50"><span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${invoiceRequired ? "bg-blue-600" : "bg-slate-300"}`}><span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${invoiceRequired ? "translate-x-[18px]" : "translate-x-1"}`} /></span><span className={`text-sm font-medium ${invoiceRequired ? "text-blue-700" : "text-slate-500"}`}>{invoiceRequired ? "Faktur" : "Non-Faktur"}</span></button></td><td className="px-4 py-3"><RelationCount value={supplier.purchase_count} /></td><td className="px-4 py-3">{canManage ? <div className="flex justify-end gap-1.5"><Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => openEdit(supplier)}><Pencil size={13} />Edit</Button><MasterAction isActive={Boolean(supplier.is_active)} relatedCount={supplier.related_count} working={workingId === supplier.id} label="Supplier" onArchive={() => void runAction(supplier, "archive")} onRestore={() => void runAction(supplier, "restore")} onDelete={() => void runAction(supplier, "delete")} /></div> : <div className="text-right"><span className="text-xs text-slate-400">Hanya lihat</span></div>}</td></tr>; }) : <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{suppliers.length ? "Supplier tidak ditemukan." : "Belum ada supplier."}</td></tr>}</tbody></table></div><ListPagination page={currentPage} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPage={setPage} /></section>
    {canManage && <FloatingAddButton label="Tambah supplier" onClick={openAdd} />}
    {formOpen && <Modal title={editing ? "Edit supplier" : "Tambah supplier"} subtitle="Data master supplier untuk transaksi pembelian." onClose={() => setFormOpen(false)} size="max-w-xl"><div className="space-y-4"><ErrorBanner message={error} /><Field label="Nama supplier" required><input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Kode supplier" hint="Kosongkan untuk membuat kode otomatis."><input className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} /></Field><div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3"><div><p className="text-sm font-medium text-slate-800">Nilai awal faktur</p><p className="mt-0.5 text-xs text-slate-500">Dipakai sebagai nilai awal toggle tiap barang di pembelian baru; bisa diubah per barang.</p></div><button type="button" role="switch" aria-checked={defaultInvoiceRequirement === "REQUIRED"} aria-label={`Nilai awal ${defaultInvoiceRequirement === "REQUIRED" ? "Faktur" : "Non-Faktur"}`} onClick={() => setDefaultInvoiceRequirement((value) => value === "REQUIRED" ? "NOT_REQUIRED" : "REQUIRED")} className="inline-flex shrink-0 items-center gap-2 rounded-lg py-1 pl-2 text-left"><span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${defaultInvoiceRequirement === "REQUIRED" ? "bg-blue-600" : "bg-slate-300"}`}><span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${defaultInvoiceRequirement === "REQUIRED" ? "translate-x-[18px]" : "translate-x-1"}`} /></span><span className={`text-sm font-medium ${defaultInvoiceRequirement === "REQUIRED" ? "text-blue-700" : "text-slate-500"}`}>{defaultInvoiceRequirement === "REQUIRED" ? "Faktur" : "Non-Faktur"}</span></button></div><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Batal</Button><Button loading={saving} disabled={!name.trim()} onClick={() => void save()}>{editing ? "Simpan perubahan" : "Tambah supplier"}</Button></div></div></Modal>}
  </>;
}

function ProjectSettings({ user, notify }: { user: User; notify: Props["notify"] }) {
  const queryClient = useQueryClient();
  const canManage = user.role === "PURCHASING" || user.role === "ADMIN";
  const [search, setSearch] = useState(""); const [pageSize, setPageSize] = useState(25); const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 500);
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [workingId, setWorkingId] = useState<string | null>(null);
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const filtered = projects.filter((project) => `${project.project_code} ${project.name} ${project.is_active ? "aktif" : "nonaktif"}`.toLocaleLowerCase().includes(debouncedSearch.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const currentPage = Math.min(page, pageCount); const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function openAdd() { if (!canManage) return; setEditing(null); setName(""); setCode(""); setError(""); setFormOpen(true); }
  function openEdit(project: Project) { if (!canManage) return; setEditing(project); setName(project.name); setCode(project.project_code); setError(""); setFormOpen(true); }
  async function save() { if (!canManage) return; setSaving(true); setError(""); try { const body = { name: name.trim(), project_code: code.trim() || undefined }; await api(editing ? `/api/projects/${editing.id}` : "/api/projects", { method: editing ? "PUT" : "POST", body: jsonBody(body) }); await queryClient.invalidateQueries({ queryKey: ["projects"] }); await queryClient.invalidateQueries({ queryKey: ["purchases"] }); setFormOpen(false); notify(editing ? "Project diperbarui." : "Project ditambahkan.", "success"); } catch (e: any) { setError(e.message); } finally { setSaving(false); } }
  async function runAction(project: Project, action: "archive" | "restore" | "delete") {
    if (!canManage) return;
    const copy = action === "archive"
      ? { title: `Arsipkan project ${project.name}?`, text: "Project tidak akan tersedia untuk transaksi baru. Relasi barang pada riwayat pembelian tetap tersimpan.", confirmButtonText: "Ya, Arsipkan", danger: false }
      : action === "restore"
        ? { title: `Pulihkan project ${project.name}?`, text: "Project akan tersedia kembali untuk transaksi baru.", confirmButtonText: "Ya, Pulihkan", danger: false }
        : { title: `Hapus project ${project.name} permanen?`, text: "Project ini belum dipakai pada barang pembelian. Penghapusan tidak dapat dibatalkan.", confirmButtonText: "Ya, Hapus", danger: true };
    if (!(await confirmAction(copy))) return;
    setWorkingId(project.id);
    try {
      if (action === "delete") await api(`/api/projects/${project.id}`, { method: "DELETE" });
      else await api(`/api/projects/${project.id}`, { method: "PUT", body: jsonBody({ is_active: action === "restore" ? 1 : 0 }) });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      notify(action === "archive" ? "Project diarsipkan; riwayat tetap tersimpan." : action === "restore" ? "Project dipulihkan." : "Project dihapus.", "success");
    } catch (e: any) { notify(e.message, "error"); }
    finally { setWorkingId(null); }
  }
  return <>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Master project</div><ListToolbar search={search} onSearch={(value) => { setSearch(value); setPage(1); }} pageSize={pageSize} onPageSize={(value) => { setPageSize(value); setPage(1); }} placeholder="Cari kode atau nama project…" /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Kode</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Pembelian terkait</th><th className="px-4 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{isLoading ? <TableLoadingRow columns={4} label="Mengambil master project…" /> : visible.length ? visible.map((project) => <tr key={project.id} className={`hover:bg-slate-50/70 ${project.is_active ? "" : "bg-slate-50/60"}`}><td className="px-4 py-3 font-medium text-slate-700">{project.project_code}</td><td className="px-4 py-3 text-slate-900"><div className="flex flex-wrap items-center gap-2"><span>{project.name}</span>{!project.is_active && <StatusBadge value="INACTIVE" />}</div></td><td className="px-4 py-3"><RelationCount value={project.purchase_count} /></td><td className="px-4 py-3">{canManage ? <div className="flex justify-end gap-1.5"><Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => openEdit(project)}><Pencil size={13} />Edit</Button><MasterAction isActive={Boolean(project.is_active)} relatedCount={project.related_count} working={workingId === project.id} label="Project" onArchive={() => void runAction(project, "archive")} onRestore={() => void runAction(project, "restore")} onDelete={() => void runAction(project, "delete")} /></div> : <div className="text-right"><span className="text-xs text-slate-400">Hanya lihat</span></div>}</td></tr>) : <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">{projects.length ? "Project tidak ditemukan." : "Belum ada project."}</td></tr>}</tbody></table></div><ListPagination page={currentPage} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPage={setPage} /></section>
    {canManage && <FloatingAddButton label="Tambah project" onClick={openAdd} />}
    {formOpen && <Modal title={editing ? "Edit project" : "Tambah project"} subtitle="Data master project untuk transaksi pembelian." onClose={() => setFormOpen(false)} size="max-w-xl"><div className="space-y-4"><ErrorBanner message={error} /><Field label="Nama project" required><input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Kode project" hint="Kosongkan untuk membuat kode otomatis."><input className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} /></Field><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Batal</Button><Button loading={saving} disabled={!name.trim()} onClick={() => void save()}>{editing ? "Simpan perubahan" : "Tambah project"}</Button></div></div></Modal>}
  </>;
}

type ManagedUser = User & { is_active: number; purchase_count?: number | string; related_count?: number | string };
function UserSettings({ currentUser, notify }: { currentUser: User; notify: Props["notify"] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(""); const [pageSize, setPageSize] = useState(25); const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 500);
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<User["role"]>("PURCHASING");
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const { data: users = [], isLoading } = useQuery({ queryKey: ["users"], queryFn: () => api<ManagedUser[]>("/api/users") });
  const filtered = users.filter((user) => `${user.name} ${user.email} ${user.role} ${user.is_active ? "aktif" : "nonaktif"}`.toLocaleLowerCase().includes(debouncedSearch.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const currentPage = Math.min(page, pageCount); const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function openAdd() { setEditing(null); setName(""); setEmail(""); setPassword(""); setRole("PURCHASING"); setError(""); setFormOpen(true); }
  function openEdit(user: ManagedUser) { setEditing(user); setName(user.name); setEmail(user.email); setPassword(""); setRole(user.role); setError(""); setFormOpen(true); }
  async function save() { setSaving(true); setError(""); try { const body = editing ? { name: name.trim(), email: email.trim(), role } : { name: name.trim(), email: email.trim(), password, role }; await api(editing ? `/api/users/${editing.id}` : "/api/users", { method: editing ? "PATCH" : "POST", body: jsonBody(body) }); await queryClient.invalidateQueries({ queryKey: ["users"] }); setFormOpen(false); notify(editing ? "Data pengguna diperbarui." : "Akun berhasil dibuat.", "success"); } catch (e: any) { setError(e.message); } finally { setSaving(false); } }
  async function runAction(account: ManagedUser, action: "archive" | "restore" | "delete") {
    const copy = action === "archive"
      ? { title: `Arsipkan akun ${account.name}?`, text: "Akun tidak dapat digunakan untuk login. Riwayat transaksi dan aktivitas tetap utuh.", confirmButtonText: "Ya, Arsipkan", danger: false }
      : action === "restore"
        ? { title: `Pulihkan akun ${account.name}?`, text: "Pengguna akan dapat login kembali.", confirmButtonText: "Ya, Pulihkan", danger: false }
        : { title: `Hapus akun ${account.name} permanen?`, text: "Akun ini belum terkait dengan pembelian atau aktivitas. Penghapusan tidak dapat dibatalkan.", confirmButtonText: "Ya, Hapus", danger: true };
    if (!(await confirmAction(copy))) return;
    setUpdatingUserId(account.id);
    try {
      if (action === "delete") await api(`/api/users/${account.id}`, { method: "DELETE" });
      else await api(`/api/users/${account.id}`, { method: "PATCH", body: jsonBody({ is_active: action === "restore" ? 1 : 0 }) });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      notify(action === "archive" ? "Akun diarsipkan; riwayat tetap tersimpan." : action === "restore" ? "Akun dipulihkan." : "Akun dihapus.", "success");
    } catch (e: any) { notify(e.message, "error"); }
    finally { setUpdatingUserId(null); }
  }
  return <>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Akun pengguna</div><ListToolbar search={search} onSearch={(value) => { setSearch(value); setPage(1); }} pageSize={pageSize} onPageSize={(value) => { setPageSize(value); setPage(1); }} placeholder="Cari nama, email, role, atau status…" /><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Nama</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Pembelian terkait</th><th className="px-4 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{isLoading ? <TableLoadingRow columns={5} label="Mengambil daftar pengguna…" /> : visible.length ? visible.map((account) => <tr key={account.id} className={`hover:bg-slate-50/70 ${account.is_active ? "" : "bg-slate-50/60"}`}><td className="px-4 py-3 font-medium text-slate-900"><div className="flex flex-wrap items-center gap-2"><span>{account.name}</span>{!account.is_active && <StatusBadge value="INACTIVE" />}</div></td><td className="px-4 py-3 text-slate-700">{account.email}</td><td className="px-4 py-3 text-slate-700">{account.role === "TAX_STAFF" ? "Staff Pajak" : account.role === "PURCHASING" ? "Purchasing" : "Admin"}</td><td className="px-4 py-3"><RelationCount value={account.purchase_count} /></td><td className="px-4 py-3"><div className="flex justify-end gap-1.5"><Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={account.id === currentUser.id} title={account.id === currentUser.id ? "Ubah profil sendiri melalui Pengaturan Akun." : "Edit pengguna"} onClick={() => openEdit(account)}><Pencil size={13} />Edit</Button><MasterAction isActive={Boolean(account.is_active)} relatedCount={account.related_count} working={updatingUserId === account.id} self={account.id === currentUser.id} label="Akun" onArchive={() => void runAction(account, "archive")} onRestore={() => void runAction(account, "restore")} onDelete={() => void runAction(account, "delete")} /></div></td></tr>) : <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">{users.length ? "Pengguna tidak ditemukan." : "Belum ada pengguna."}</td></tr>}</tbody></table></div><ListPagination page={currentPage} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPage={setPage} /></section>
    <FloatingAddButton label="Tambah pengguna" onClick={openAdd} />
    {formOpen && <Modal title={editing ? "Edit pengguna" : "Buat akun pengguna"} subtitle={editing ? "Perbarui nama, email, dan hak akses pengguna." : "Buat akun baru untuk anggota tim."} onClose={() => setFormOpen(false)} size="max-w-xl"><div className="space-y-4"><ErrorBanner message={error} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Nama" required><input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Email" required><input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>{!editing && <Field label="Password" required hint="Minimal 12 karakter."><input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>}<Field label="Role"><select className={inputClass} value={role} onChange={(event) => setRole(event.target.value as User["role"])}><option value="PURCHASING">Purchasing</option><option value="TAX_STAFF">Staff Pajak</option><option value="ADMIN">Admin</option></select></Field></div><div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Batal</Button><Button loading={saving} disabled={!name.trim() || !email.trim() || (!editing && password.length < 12)} onClick={() => void save()}>{editing ? "Simpan perubahan" : "Buat akun"}</Button></div></div></Modal>}
  </>;
}

function AuditSettings() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["audit", page], queryFn: () => api<PageResult<AuditRow>>(`/api/reports/audit?page=${page}&pageSize=50`) });
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Jejak aktivitas</div>{isLoading ? <div className="px-4"><LoadingState label="Mengambil jejak aktivitas…" compact /></div> : !data?.data.length ? <div className="p-4"><EmptyState title="Belum ada aktivitas" description="Aktivitas penting aplikasi akan tercatat di sini." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Waktu</th><th className="px-4 py-3">Pengguna</th><th className="px-4 py-3">Aksi</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Alasan</th></tr></thead><tbody className="divide-y divide-slate-100">{data.data.map((log) => <tr key={log.id}><td className="px-4 py-3 text-xs text-slate-600">{dateTimeText(log.created_at)}</td><td className="px-4 py-3 text-slate-800">{log.user_name || "Sistem"}</td><td className="px-4 py-3 font-medium text-slate-900">{log.action}</td><td className="px-4 py-3 text-slate-700">{log.entity_type} · {log.entity_id || "—"}</td><td className="px-4 py-3 text-slate-700">{log.reason || "—"}</td></tr>)}</tbody></table></div>}<div className="flex justify-end gap-2 border-t border-slate-100 p-3"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Sebelumnya</Button><Button variant="secondary" disabled={!data || page >= data.totalPages} onClick={() => setPage((n) => n + 1)}>Berikutnya</Button></div></section>;
}
