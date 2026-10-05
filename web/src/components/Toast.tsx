import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onApiError } from '../api/client';

interface ToastItem { id: number; message: string; tone: 'error' | 'info' }
interface ToastApi { show: (message: string, tone?: ToastItem['tone']) => void }

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((all) => [...all.slice(-3), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), 7000);
  }, [dismiss]);

  // every API refusal reaches the person in the database's own plain words
  useEffect(() => {
    onApiError((e) => show(e.message, 'error'));
    return () => onApiError(null);
  }, [show]);

  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md flex-col gap-2 p-4">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
               className={`flex items-start justify-between gap-3 rounded-[24px] border-[1.5px] px-5 py-3 ${
                 t.tone === 'error' ? 'border-fault bg-chalk text-fault' : 'border-obsidian bg-limestone text-obsidian'}`}>
            <span>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-ink-soft">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
