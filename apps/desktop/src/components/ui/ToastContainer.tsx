import { AnimatePresence } from "framer-motion";
import { useToastStore } from "../../stores/toastStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { ToastPosition } from "../../stores/settingsStore";
import { Toast } from "./Toast";
import "./Toast.css";

const positionStyles: Record<ToastPosition, React.CSSProperties> = {
  'bottom-right': { bottom: 16, right: 16 },
  'bottom-left': { bottom: 16, left: 16 },
  'top-right': { top: 80, right: 16 },
  'top-left': { top: 80, left: 16 },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const enabled = useSettingsStore((s) => s.notifications.enabled);
  const position = useSettingsStore((s) => s.notifications.position);

  if (!enabled || toasts.length === 0) return null;

  return (
    <div className="toast-container" style={positionStyles[position]}>
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            toast={toast}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
