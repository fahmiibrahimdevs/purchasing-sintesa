import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating } from "@tanstack/react-query";
import { ChevronDown, Database, LayoutDashboard, LogOut, Menu, ReceiptText, Settings2, ShoppingBag, X } from "lucide-react";
import { api } from "./lib/api";
import { showToast } from "./lib/swal";
import { PurchaseItem, User } from "./types";
import { AccountSettingsPage } from "./components/AccountSettingsPage";
import { AppLoadingScreen, AsyncProgress } from "./components/common";
import { DashboardPage } from "./components/DashboardPage";
import { InvoiceEditPage, InvoicePage } from "./components/InvoicePage";
import { InvoiceCreatePage } from "./components/InvoiceCreatePage";
import { LoginPage } from "./components/LoginPage";
import { PurchasePage } from "./components/PurchasePage";
import { MasterDataPage, SettingsPage } from "./components/SettingsPage";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } } });
type Page = "dashboard" | "purchases" | "invoices" | "invoice-new" | "invoice-edit" | "suppliers" | "projects" | "settings" | "account";
const pages: Page[] = ["dashboard", "purchases", "invoices", "invoice-new", "invoice-edit", "suppliers", "projects", "settings", "account"];

function pageFromLocation(): Page {
  const rawHash = window.location.hash.slice(1).split("?")[0];
  const rawCandidate = rawHash === "invoices/new" ? "invoice-new" : rawHash.startsWith("invoices/edit/") ? "invoice-edit" : rawHash.split("/")[0];
  const candidate = (rawCandidate === "queue" ? "invoices" : rawCandidate) as Page;
  return pages.includes(candidate) ? candidate : "dashboard";
}

function replacementIdFromLocation() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith("invoices/new?")) return "";
  return new URLSearchParams(hash.slice(hash.indexOf("?") + 1)).get("replacement") || "";
}

function canAccessPage(role: User["role"], page: Page) {
  if (role === "PURCHASING" && (page === "invoice-new" || page === "invoice-edit")) return false;
  if (role !== "ADMIN" && page === "settings") return false;
  return true;
}

function Workspace() {
  const fetchingCount = useIsFetching();
  const mutatingCount = useIsMutating();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [page, setPage] = useState<Page>(pageFromLocation);
  const [initialInvoiceItem, setInitialInvoiceItem] = useState<PurchaseItem | null>(null);
  const [replacementInvoiceId, setReplacementInvoiceId] = useState(replacementIdFromLocation);
  const [editingInvoiceId, setEditingInvoiceId] = useState(() => window.location.hash.slice(1).startsWith("invoices/edit/") ? window.location.hash.slice(1).split("/")[2] || "" : "");
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [masterDataOpen, setMasterDataOpen] = useState(false);
  const [navHighlight, setNavHighlight] = useState<{ q?: string; highlightId?: string } | null>(null);

  useEffect(() => { api<User>("/api/auth/me").then(setUser).catch(() => setUser(null)).finally(() => setAuthLoading(false)); }, []);
  useEffect(() => {
    const syncPage = () => {
      const hash = window.location.hash.slice(1);
      setPage(pageFromLocation());
      setEditingInvoiceId(hash.startsWith("invoices/edit/") ? hash.split("/")[2] || "" : "");
      setReplacementInvoiceId(replacementIdFromLocation());
    };
    window.addEventListener("popstate", syncPage);
    window.addEventListener("hashchange", syncPage);
    return () => {
      window.removeEventListener("popstate", syncPage);
      window.removeEventListener("hashchange", syncPage);
    };
  }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);
  const notify = (message: string, kind: "success" | "error" = "success") => { void showToast(message, kind); };
  const navigate = (target: string, options?: { q?: string; highlightId?: string } | boolean, maybeOptions?: { q?: string; highlightId?: string }) => {
    if (!pages.includes(target as Page)) return;
    const nextPage = target as Page;
    if (user && !canAccessPage(user.role, nextPage)) return;
    if (nextPage !== "invoice-new") setReplacementInvoiceId("");
    setPage(nextPage);
    const replace = typeof options === "boolean" ? options : false;
    const navOpts = typeof options === "object" && options !== null ? options : maybeOptions || null;
    setNavHighlight(navOpts);
    const routeHash = nextPage === "invoice-new" ? "invoices/new" : nextPage;
    const nextUrl = `${window.location.pathname}${window.location.search}${nextPage === "dashboard" ? "" : `#${routeHash}`}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    }
  };
  useEffect(() => {
    if (!user || canAccessPage(user.role, page)) return;
    setPage("dashboard");
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  }, [user, page]);
  useEffect(() => {
    if (page === "suppliers" || page === "projects") setMasterDataOpen(true);
  }, [page]);
  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* expire local view even if the network is unavailable */ }
    setUser(null); navigate("dashboard", true); setProfileOpen(false); setSidebarOpen(false); queryClient.clear();
  }

  if (authLoading) return <AppLoadingScreen />;
  if (!user) return <LoginPage onLoggedIn={(nextUser) => { setUser(nextUser); navigate("dashboard", true); queryClient.invalidateQueries(); }} />;

  const navItems: Array<{ id: Page; label: string; icon: any; visible: boolean }> = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, visible: true },
    { id: "purchases", label: "Pembelian", icon: ShoppingBag, visible: true },
    { id: "invoices", label: "Faktur Pajak", icon: ReceiptText, visible: true },
    { id: "settings", label: "Pengaturan", icon: Settings2, visible: user.role === "ADMIN" },
  ];
  const roleLabel = user.role === "PURCHASING" ? "Purchasing" : user.role === "TAX_STAFF" ? "Staff Pajak" : "Admin";
  const visibleNavItems = navItems.filter((item) => item.visible);
  const pageLabel = page === "account" ? "Pengaturan Akun" : page === "suppliers" ? "Supplier" : page === "projects" ? "Project" : page === "invoice-new" ? (replacementInvoiceId ? "Input Faktur Pajak Pengganti" : "Input Faktur Pajak") : page === "invoice-edit" ? "Edit Faktur Pajak" : visibleNavItems.find((item) => item.id === page)?.label || "Dashboard";
  const renderNavItem = (item: (typeof navItems)[number], compact = false, mobile = false) => {
    const active = page === item.id || (item.id === "invoices" && (page === "invoice-new" || page === "invoice-edit"));
    return <button key={item.id} title={compact ? item.label : undefined} aria-label={compact ? item.label : undefined} onClick={() => { navigate(item.id); setSidebarOpen(false); }} className={`flex min-h-11 w-full items-center gap-3 border-l-[3px] text-left text-sm font-medium transition ${compact ? "justify-center rounded-r-xl px-3" : `rounded-r-xl ${mobile ? "pl-3 pr-3" : "pl-5 pr-3"}`} ${active ? "border-blue-600 bg-blue-50/70 text-blue-700" : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}><item.icon size={17} className="shrink-0" /><span className={compact ? "sr-only" : ""}>{item.label}</span>{active && !compact && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-600" />}</button>;
  };
  const renderMasterData = (compact = false, mobile = false) => {
    const active = page === "suppliers" || page === "projects";
    const expanded = masterDataOpen || active;
    const childClass = (childPage: "suppliers" | "projects") => `flex min-h-9 w-full items-center rounded-lg px-3 text-left text-sm transition ${page === childPage ? "font-medium text-blue-700" : "text-slate-500 hover:text-slate-900"}`;
    return <div key="master-data">
      <button type="button" title={compact ? "Master Data" : undefined} aria-label={compact ? "Master Data" : undefined} aria-expanded={expanded} onClick={() => { if (compact) { setSidebarCollapsed(false); setMasterDataOpen(true); } else setMasterDataOpen((open) => !open); }} className={`flex min-h-11 w-full items-center gap-3 text-left text-sm font-medium transition ${compact ? "justify-center rounded-r-xl px-3" : `rounded-r-xl ${mobile ? "pl-3 pr-3" : "pl-5 pr-3"}`} text-slate-500 hover:bg-slate-50 hover:text-slate-900`}><Database size={17} className="shrink-0" /><span className={compact ? "sr-only" : ""}>Master Data</span>{!compact && <ChevronDown size={15} className={`ml-auto transition-transform ${expanded ? "rotate-180" : ""}`} />}</button>
      {!compact && expanded && <div className={`${mobile ? "ml-5" : "ml-7"} space-y-1 pl-2`}>
        <button type="button" onClick={() => { navigate("suppliers"); setSidebarOpen(false); }} className={childClass("suppliers")}>Supplier</button>
        <button type="button" onClick={() => { navigate("projects"); setSidebarOpen(false); }} className={childClass("projects")}>Project</button>
      </div>}
    </div>;
  };
  const logo = <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm"><ReceiptText size={18} /></span>;
  return <div className="min-h-screen bg-[#f4f6f9] text-slate-900">
    <AsyncProgress active={fetchingCount > 0 || mutatingCount > 0} />
    <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex ${sidebarCollapsed ? "w-[76px]" : "w-[250px]"}`}>
      <div className="flex h-[70px] shrink-0 items-center gap-3 border-b border-slate-100 px-5">{logo}<span className={sidebarCollapsed ? "hidden" : "min-w-0"}><b className="block text-sm font-bold tracking-[.16em] text-slate-900">PROCURA</b><small className="block text-[9px] font-medium uppercase tracking-wider text-slate-400">Purchasing Workspace</small></span></div>
      <nav className={`flex-1 overflow-y-auto py-5 ${sidebarCollapsed ? "px-2" : "pr-3"}`}>
        <p className={`mb-2 px-5 text-[11px] font-semibold uppercase tracking-[.1em] text-slate-500 ${sidebarCollapsed ? "sr-only" : ""}`}>Dashboard</p>
        {visibleNavItems.filter((item) => item.id === "dashboard").map((item) => renderNavItem(item, sidebarCollapsed))}
        <p className={`mb-2 mt-6 px-5 text-[11px] font-semibold uppercase tracking-[.1em] text-slate-500 ${sidebarCollapsed ? "sr-only" : ""}`}>Menu Utama</p>
        <div className="space-y-1">{visibleNavItems.filter((item) => !["dashboard", "settings"].includes(item.id)).map((item) => renderNavItem(item, sidebarCollapsed))}{renderMasterData(sidebarCollapsed)}{visibleNavItems.filter((item) => item.id === "settings").map((item) => renderNavItem(item, sidebarCollapsed))}</div>
      </nav>
      {!sidebarCollapsed && <div className="border-t border-slate-100 px-5 py-4"><p className="text-[10px] font-medium text-slate-400">Procura · Workspace Pembelian</p></div>}
    </aside>
    <header className={`sticky top-0 z-30 h-[70px] bg-[#1d56a5] text-white shadow-sm transition-[margin] duration-200 ${sidebarCollapsed ? "lg:ml-[76px]" : "lg:ml-[250px]"}`}>
      <div className="flex h-full items-center justify-between gap-3 px-3 sm:px-5 lg:px-7">
        <div className="flex min-w-0 items-center gap-3"><button onClick={() => { if (window.innerWidth >= 1024) setSidebarCollapsed((collapsed) => !collapsed); else setSidebarOpen(true); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/90 transition hover:bg-white/10 hover:text-white" aria-label="Buka atau ciutkan sidebar"><Menu size={21} /></button><span className="truncate text-sm font-semibold lg:hidden">Procura</span></div>
        <div className="relative shrink-0"><button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/10" aria-expanded={profileOpen}><span className="grid h-8 w-8 place-items-center rounded-full bg-indigo-300 text-sm font-semibold text-white">{user.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span><span className="hidden text-left sm:block"><b className="block max-w-[160px] truncate text-xs font-semibold text-white">{user.name}</b><small className="block text-[10px] text-blue-100">{roleLabel}</small></span><ChevronDown size={14} className="text-blue-100" /></button>
          {profileOpen && <><button aria-label="Tutup menu profil" className="fixed inset-0 z-30 cursor-default" onClick={() => setProfileOpen(false)} /><div className="absolute right-0 z-40 mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl"><div className="border-b border-slate-100 px-3 py-2"><p className="text-sm font-semibold text-slate-900">{user.name}</p><p className="text-xs text-slate-600">{user.email}</p></div><button onClick={() => { navigate("account"); setProfileOpen(false); }} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700"><Settings2 size={15} />Pengaturan Akun</button><button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50"><LogOut size={15} />Keluar</button></div></>}
        </div>
      </div>
    </header>
    {sidebarOpen && <><button className="fixed inset-0 z-40 bg-slate-950/35 lg:hidden" aria-label="Tutup navigasi" onClick={() => setSidebarOpen(false)} /><aside className="fixed inset-y-0 left-0 z-50 flex w-[min(84vw,320px)] flex-col border-r border-slate-200 bg-white shadow-2xl lg:hidden"><div className="flex h-[70px] shrink-0 items-center justify-between border-b border-slate-100 px-5"> <div className="flex items-center gap-3">{logo}<span><b className="block text-sm font-bold tracking-[.16em] text-slate-900">PROCURA</b><small className="block text-[9px] font-medium uppercase tracking-wider text-slate-400">Purchasing Workspace</small></span></div><button onClick={() => setSidebarOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Tutup navigasi"><X size={18} /></button></div><nav className="flex-1 overflow-y-auto px-4 py-5"><p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[.1em] text-slate-500">Dashboard</p><div>{visibleNavItems.filter((item) => item.id === "dashboard").map((item) => renderNavItem(item, false, true))}</div><p className="mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[.1em] text-slate-500">Menu Utama</p><div className="space-y-1">{visibleNavItems.filter((item) => !["dashboard", "settings"].includes(item.id)).map((item) => renderNavItem(item, false, true))}{renderMasterData(false, true)}{visibleNavItems.filter((item) => item.id === "settings").map((item) => renderNavItem(item, false, true))}</div></nav></aside></>}
    <div className={`min-h-[calc(100vh-70px)] transition-[margin] duration-200 ${sidebarCollapsed ? "lg:ml-[76px]" : "lg:ml-[250px]"}`}>
      <div className="sticky top-[70px] z-20 flex min-h-[72px] items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8"><h1 className="text-lg font-semibold text-slate-800">{pageLabel}</h1><div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500"><span className="text-blue-700">Dashboard</span><span>/</span><span>{pageLabel === "Dashboard" ? "Utama" : pageLabel}</span></div></div>
      <div className="mx-auto flex min-h-[calc(100vh-142px)] w-full max-w-[2304px] flex-col"><main className="w-full min-w-0 flex-1 px-3 py-5 sm:px-6 sm:py-7 2xl:px-10">
        {page === "dashboard" && <DashboardPage user={user} onNavigate={navigate} />}
        {page === "purchases" && <PurchasePage user={user} notify={notify} navHighlight={navHighlight} onClearNavHighlight={() => setNavHighlight(null)} />}
        {page === "invoices" && <InvoicePage user={user} notify={notify} navHighlight={navHighlight} onClearNavHighlight={() => setNavHighlight(null)} onCreateInvoice={(item) => { setReplacementInvoiceId(""); setInitialInvoiceItem(item || null); navigate("invoice-new"); }} onEditInvoice={(id) => { setReplacementInvoiceId(""); setEditingInvoiceId(id); setPage("invoice-edit"); window.history.pushState({}, "", `${window.location.pathname}${window.location.search}#invoices/edit/${id}`); }} />}
        {page === "invoice-new" && <InvoiceCreatePage initialItem={initialInvoiceItem} replacementInvoiceId={replacementInvoiceId} userName={user.name} notify={notify} onBack={() => { setInitialInvoiceItem(null); setReplacementInvoiceId(""); navigate("invoices"); }} />}
        {page === "invoice-edit" && <InvoiceEditPage invoiceId={editingInvoiceId} userName={user.name} notify={notify} onBack={() => navigate("invoices")} onCreateReplacement={(id) => { setInitialInvoiceItem(null); setReplacementInvoiceId(id); setPage("invoice-new"); window.history.pushState({}, "", `${window.location.pathname}${window.location.search}#invoices/new?replacement=${encodeURIComponent(id)}`); }} />}
        {(page === "suppliers" || page === "projects") && <MasterDataPage section={page} user={user} notify={notify} />}
        {page === "settings" && <SettingsPage user={user} notify={notify} />}
        {page === "account" && <AccountSettingsPage user={user} onUserUpdated={setUser} notify={notify} />}
      </main><footer className="px-4 pb-5 text-center text-xs text-slate-500">Procura · Workspace Pembelian & Faktur Pajak</footer></div>
    </div>
  </div>;
}

export default function App() {
  return <QueryClientProvider client={queryClient}><Workspace /></QueryClientProvider>;
}
