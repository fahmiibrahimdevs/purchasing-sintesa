import { useState } from "react";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { api, jsonBody } from "../lib/api";
import { User } from "../types";
import { Button, ErrorBanner, Field, inputClass, SectionHeading } from "./common";

type Props = {
  user: User;
  onUserUpdated: (user: User) => void;
  notify: (message: string, kind?: "success" | "error") => void;
};

const roleLabels: Record<User["role"], string> = {
  ADMIN: "Admin",
  PURCHASING: "Purchasing",
  TAX_STAFF: "Staff Pajak",
};

export function AccountSettingsPage({ user, onUserUpdated, notify }: Props) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [profileError, setProfileError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setProfileSaving(true);
    try {
      const updated = await api<User>("/api/auth/profile", { method: "PATCH", body: jsonBody({ name, email }) });
      onUserUpdated(updated);
      setName(updated.name);
      setEmail(updated.email);
      notify("Profil berhasil diperbarui.", "success");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profil tidak dapat diperbarui.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("Konfirmasi kata sandi baru belum sama.");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("Kata sandi baru minimal 12 karakter.");
      return;
    }
    setPasswordSaving(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: jsonBody({ currentPassword, newPassword }) });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify("Kata sandi berhasil diubah. Sesi akun di perangkat lain sudah dikeluarkan.", "success");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Kata sandi tidak dapat diubah.");
    } finally {
      setPasswordSaving(false);
    }
  }

  return <div>
    <SectionHeading title="Pengaturan Akun" description="Perbarui informasi profil dan jaga keamanan akun Anda." />
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
        <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><UserRound size={19} /></span>
          <div><h3 className="font-semibold text-slate-900">Profil</h3><p className="text-xs text-slate-500">Nama dan email akun yang digunakan untuk masuk.</p></div>
        </div>
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600"><ShieldCheck size={16} className="text-emerald-600" /><span>Hak akses: <strong className="font-semibold text-slate-800">{roleLabels[user.role]}</strong></span></div>
        <form onSubmit={saveProfile} className="space-y-3">
          <ErrorBanner message={profileError} />
          <Field label="Nama lengkap" required><input className={inputClass} autoComplete="name" maxLength={200} required value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Email" required hint="Email ini digunakan untuk masuk ke Procura."><input className={inputClass} type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <div className="flex justify-end pt-1"><Button type="submit" loading={profileSaving} disabled={!name.trim() || !email.trim()}>{profileSaving ? "Menyimpan…" : "Simpan Profil"}</Button></div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
        <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><KeyRound size={19} /></span>
          <div><h3 className="font-semibold text-slate-900">Keamanan</h3><p className="text-xs text-slate-500">Ganti kata sandi untuk melindungi akun Anda.</p></div>
        </div>
        <form onSubmit={changePassword} className="space-y-3">
          <ErrorBanner message={passwordError} />
          <Field label="Kata sandi saat ini" required><input className={inputClass} type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
          <Field label="Kata sandi baru" required hint="Gunakan minimal 12 karakter."><input className={inputClass} type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
          <Field label="Ulangi kata sandi baru" required><input className={inputClass} type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
          <div className="flex justify-end pt-1"><Button type="submit" loading={passwordSaving} disabled={!currentPassword || newPassword.length < 12 || !confirmPassword}>{passwordSaving ? "Memperbarui…" : "Ganti Kata Sandi"}</Button></div>
        </form>
      </section>
    </div>
  </div>;
}
