import { create } from 'zustand';
import { useSettingsStore } from './settingsStore';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
}

interface ToastActions {
  addToast: (message: string, type: ToastType, duration?: number) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

type ToastStore = ToastState & ToastActions;

// Track timers outside the store to avoid serialization issues
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],

  addToast: (message, type, duration) => {
    const settings = useSettingsStore.getState().notifications;
    if (!settings.enabled) return '';

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const effectiveDuration = duration ?? settings.duration;
    const maxVisible = settings.maxVisible;

    const toast: Toast = {
      id,
      type,
      message,
      duration: effectiveDuration,
      createdAt: Date.now(),
    };

    set((state) => {
      const newToasts = [...state.toasts, toast];
      // Enforce max visible limit - remove oldest
      if (newToasts.length > maxVisible) {
        const removed = newToasts.slice(0, newToasts.length - maxVisible);
        for (const t of removed) {
          const timer = toastTimers.get(t.id);
          if (timer) {
            clearTimeout(timer);
            toastTimers.delete(t.id);
          }
        }
        return { toasts: newToasts.slice(-maxVisible) };
      }
      return { toasts: newToasts };
    });

    // Schedule auto-dismiss
    const timer = setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
      toastTimers.delete(id);
    }, effectiveDuration);

    toastTimers.set(id, timer);
    return id;
  },

  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    for (const [id, timer] of toastTimers) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set({ toasts: [] });
  },
}));
