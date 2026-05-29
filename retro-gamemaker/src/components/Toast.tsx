/**
 * Toast — a lightweight notification system for success/error/info messages.
 */

import React, { createContext, useCallback, useContext, useState, useRef, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/** Provider that wraps the app to show toasts. */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 3000) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, type, message, duration }]);
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" role="alert" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/* ─── Internal toast item ─── */

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({
  toast,
  onRemove,
}) => {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      timerRef.current = window.setTimeout(() => {
        onRemove(toast.id);
      }, toast.duration);
    }
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, onRemove]);

  const icon = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
  }[toast.type];

  return (
    <div className={`toast toast--${toast.type}`} onClick={() => onRemove(toast.id)}>
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={() => onRemove(toast.id)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
};
