import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Card: Limestone on the Pumice canvas, 40px radius, no border and no shadow (DESIGN.md surfaces). */
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-[40px] bg-limestone p-6 sm:p-10">
      {title && <h2 className="h-section mb-5">{title}</h2>}
      {children}
    </section>
  );
}

/** Ember feature card for a headline number. The label is Obsidian: small Chalk text on Ember would miss AA contrast. */
export function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="rounded-[40px] bg-ember p-8 sm:p-10">
      <p className="text-sm text-obsidian">{label}</p>
      <p className="h-stat mt-3 tabular text-chalk">{value}</p>
      {detail && <p className="mt-2 text-sm text-obsidian">{detail}</p>}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block px-2 text-sm">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 px-2 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

/** Pill input: 100px radius, 1.5px Obsidian border (DESIGN.md input field). */
export const inputClass = 'w-full rounded-full border-[1.5px] border-obsidian bg-transparent px-5 py-2.5 text-base placeholder:text-ink-soft/70 focus:bg-chalk';

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  const base = 'rounded-full px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-40';
  const look = variant === 'primary'
    ? 'bg-ember text-obsidian hover:bg-obsidian hover:text-chalk'
    : 'border-[1.5px] border-obsidian bg-transparent text-obsidian hover:bg-obsidian hover:text-chalk';
  return <button type="button" className={`${base} ${look} ${className}`} {...rest} />;
}

/** Tabs as a Limestone pill; the active tab is Ember. */
export function Tabs<T extends string>({ tabs, active, onChange, label }: { tabs: readonly T[]; active: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-limestone p-1.5">
      {tabs.map((t) => (
        <button key={t} role="tab" type="button" aria-selected={active === t} onClick={() => onChange(t)}
                className={`whitespace-nowrap rounded-full px-5 py-2 text-sm ${active === t ? 'bg-ember text-obsidian' : 'text-obsidian hover:bg-pumice'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** Time to stamp on an action performed now. A few seconds back, so a slightly fast clock never lands in the future. */
export const occurredNow = (): string => new Date(Date.now() - 30_000).toISOString();
