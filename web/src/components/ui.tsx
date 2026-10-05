import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-solder bg-tray p-4 sm:p-5">
      {title && <h2 className="mb-3 text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export const inputClass = 'w-full rounded-md border border-solder bg-white px-3 py-2 text-base';

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  const base = 'rounded-md px-4 py-2 font-medium disabled:opacity-50';
  const look = variant === 'primary' ? 'bg-trace text-white hover:bg-trace-deep' : 'border border-solder bg-white hover:bg-bench';
  return <button type="button" className={`${base} ${look} ${className}`} {...rest} />;
}

export function Tabs<T extends string>({ tabs, active, onChange, label }: { tabs: readonly T[]; active: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-solder">
      {tabs.map((t) => (
        <button key={t} role="tab" type="button" aria-selected={active === t} onClick={() => onChange(t)}
                className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${
                  active === t ? 'border-trace text-trace' : 'border-transparent text-ink-soft hover:text-ink'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** Time to stamp on an action performed now. A few seconds back, so a slightly fast clock never lands in the future. */
export const occurredNow = (): string => new Date(Date.now() - 30_000).toISOString();
