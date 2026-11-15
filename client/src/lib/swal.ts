import Swal from "sweetalert2";

export type NoticeKind = "success" | "error";

const modalClass = {
  popup: "rounded-2xl border border-slate-200 p-5 shadow-2xl",
  title: "text-base font-semibold text-slate-900",
  htmlContainer: "text-sm leading-relaxed text-slate-600",
  confirmButton: "rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700",
  cancelButton: "rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200",
  denyButton: "rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700",
  input: "rounded-xl border-slate-200 text-sm focus:border-blue-400 focus:ring-blue-100",
};

export const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3200,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  },
  customClass: { popup: "rounded-2xl border border-slate-100 font-sans shadow-xl" },
});

export function showToast(message: string, kind: NoticeKind = "success") {
  return Toast.fire({
    icon: kind,
    title: kind === "error" ? "Gagal" : message,
    ...(kind === "error" ? { text: message } : {}),
  });
}

export async function showUndoToast(message: string, onUndo: () => Promise<void>) {
  const result = await Toast.fire({
    icon: "success",
    title: message,
    showConfirmButton: true,
    confirmButtonText: "Urungkan",
    buttonsStyling: false,
    timer: 7000,
    timerProgressBar: true,
    customClass: {
      popup: "rounded-2xl border border-slate-100 font-sans shadow-xl",
      confirmButton: "rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700",
    },
  });
  if (result.isConfirmed) await onUndo();
}

export async function confirmAction({
  title,
  text,
  confirmButtonText = "Ya, lanjutkan",
  cancelButtonText = "Batal",
  danger = false,
}: {
  title: string;
  text?: string;
  confirmButtonText?: string;
  cancelButtonText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const result = await Swal.fire({
    icon: danger ? "warning" : "question",
    title,
    text,
    showCancelButton: true,
    reverseButtons: true,
    confirmButtonText,
    cancelButtonText,
    buttonsStyling: false,
    customClass: {
      ...modalClass,
      confirmButton: danger ? modalClass.denyButton : modalClass.confirmButton,
    },
  });
  return result.isConfirmed;
}

export async function promptText({
  title,
  text,
  inputPlaceholder = "Tulis di sini…",
  confirmButtonText = "Lanjutkan",
  required = false,
}: {
  title: string;
  text?: string;
  inputPlaceholder?: string;
  confirmButtonText?: string;
  required?: boolean;
}): Promise<string | null> {
  const result = await Swal.fire({
    icon: "warning",
    title,
    text,
    input: "textarea",
    inputPlaceholder,
    inputAttributes: { "aria-label": inputPlaceholder, rows: "3" },
    inputValidator: (value) => required && !String(value || "").trim() ? "Alasan wajib diisi." : undefined,
    showCancelButton: true,
    reverseButtons: true,
    confirmButtonText,
    cancelButtonText: "Batal",
    buttonsStyling: false,
    customClass: modalClass,
  });
  return result.isConfirmed ? String(result.value || "").trim() : null;
}

export default Swal;
