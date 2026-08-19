import { useEffect, ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// 4.2.2.1.3 — "Hosts create/edit forms built from the shared form
// components (4.2.2.1.1)." This component only owns the overlay/dialog
// chrome; whatever form goes inside is entirely up to the caller.
export function Modal({ open, onClose, title, children }: ModalProps): JSX.Element | null {
  // Escape-to-close is standard modal behavior; only wired up while the
  // modal is actually open, and cleaned up immediately when it isn't.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative w-full max-w-lg rounded bg-white shadow-elevation-3"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 id="modal-title" className="text-lg font-semibold text-neutral-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
