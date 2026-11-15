import { useState } from "react";
import { LockKeyhole, ReceiptText } from "lucide-react";
import { api, jsonBody } from "../lib/api";
import { Button, ErrorBanner, inputClass } from "./common";
import { User } from "../types";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const response = await api<{ user: User }>("/api/auth/login", { method: "POST", body: jsonBody({ email, password }) });
      onLoggedIn(response.user);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }
  return <div className="flex min-h-screen items-center justify-center bg-[#f4f6f9] px-4 py-10">
    <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-[1.05fr_.95fr]">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-10 text-white md:flex">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><ReceiptText size={24} /></span><span className="font-semibold">Procura</span></div>
        <div><p className="mb-3 text-sm font-semibold uppercase tracking-[.18em] text-blue-100">Purchasing workspace</p><h1 className="max-w-md text-4xl font-semibold leading-tight">Pembelian dan faktur, tercatat rapi.</h1><p className="mt-4 max-w-md text-sm leading-6 text-blue-100">Kelola dokumen pembelian, tindak lanjut supplier, dan kelengkapan faktur pajak dalam satu alur.</p></div>
        <p className="text-xs text-blue-100">Procura · Internal Operations</p>
      </div>
      <form onSubmit={submit} className="flex flex-col justify-center px-6 py-10 sm:px-10">
        <div className="mb-8 md:hidden"><div className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-blue-700"><ReceiptText size={19} /><span className="font-semibold">Procura</span></div></div>
        <span className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700"><LockKeyhole size={22} /></span>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Masuk ke akun</h2>
        <p className="mt-1 text-sm text-slate-600">Gunakan akun internal yang diberikan Admin.</p>
        <ErrorBanner message={error} />
        <div className="mt-6 space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span><input autoComplete="username" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="nama@perusahaan.id" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span><input autoComplete="current-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="Password" /></label>
          <Button type="submit" loading={loading} className="w-full py-3">{loading ? "Memeriksa akun…" : "Masuk"}</Button>
        </div>
        <p className="mt-5 text-xs leading-5 text-slate-600">Belum memiliki akun? Hubungi Admin untuk membuat akun dengan role Purchasing, Staff Pajak, atau Admin.</p>
      </form>
    </div>
  </div>;
}
