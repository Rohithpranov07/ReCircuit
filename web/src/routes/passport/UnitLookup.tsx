import { useCallback, useState, type FormEvent } from 'react';
import { api, ApiException } from '../../api/client';
import type { UnitPassport } from '../../api/types';
import { EventBadge } from '../../components/EventBadge';
import { Button, inputClass } from '../../components/ui';
import { passportIdFrom } from './PassportFinder';
import { QrScanner } from './QrScanner';

interface Props {
  label: string;
  /** called with the passport once a code resolves */
  onFound: (passport: UnitPassport) => void;
  /** called when the code is well-formed but unknown (the collector may offer to register it) */
  onUnknown?: (passportUid: string) => void;
}

/** Scan a QR code or paste a passport id/link, and resolve it to a unit. */
export function UnitLookup({ label, onFound, onUnknown }: Props) {
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<UnitPassport | null>(null);

  const resolve = useCallback(async (raw: string) => {
    const uid = passportIdFrom(raw);
    if (!uid) {
      setProblem('That is not a ReCircuit passport. A passport ID looks like 8f3c2a1e-…');
      return;
    }
    setProblem(null);
    try {
      const passport = await api<UnitPassport>(`/units/${uid}`, { quiet: true });
      setFound(passport);
      onFound(passport);
    } catch (err) {
      setFound(null);
      if (err instanceof ApiException && err.status === 404) {
        setProblem('No passport matches that code.');
        onUnknown?.(uid);
      } else if (err instanceof Error) {
        setProblem(err.message);
      }
    }
  }, [onFound, onUnknown]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void resolve(text);
  }

  return (
    <div>
      <label htmlFor={`lookup-${label}`} className="block text-sm font-medium">{label}</label>
      <form onSubmit={submit} className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input id={`lookup-${label}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a passport ID or link"
               className={`${inputClass} min-w-0 flex-1`} />
        <Button type="submit">Find</Button>
        <Button variant="quiet" onClick={() => setScanning((s) => !s)}>{scanning ? 'Hide camera' : 'Scan QR'}</Button>
      </form>
      {scanning && (
        <div className="mt-3">
          <QrScanner onScan={(t) => { setText(t); setScanning(false); void resolve(t); }} onClose={() => setScanning(false)} />
        </div>
      )}
      {problem && <p role="alert" className="mt-2 text-sm text-fault">{problem}</p>}
      {found && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-solder bg-white p-3" data-testid="found-unit">
          <div className="min-w-0">
            <p className="font-medium">{found.model.model_number} <span className="text-sm font-normal text-ink-soft">· {found.serial_no}</span></p>
            <p className="text-sm text-ink-soft">{found.model.category.toLowerCase()}{found.current_parent && ` · inside ${found.current_parent.model_number}`}</p>
          </div>
          {found.current_state ? <EventBadge type={found.current_state} /> : <span className="text-sm text-ink-soft">No events yet</span>}
        </div>
      )}
    </div>
  );
}
