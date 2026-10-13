import { create } from 'zustand';
import { uid } from '../lib/format';

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show: (message, tone = 'info') => {
    const id = uid('toast');
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 2600);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (m: string) => useToasts.getState().show(m, 'info'),
  success: (m: string) => useToasts.getState().show(m, 'success'),
  error: (m: string) => useToasts.getState().show(m, 'error'),
};
