import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { QrScanner } from './QrScanner';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Pulls a passport id out of a scanned URL (…/p/<uid>) or a pasted id. */
export function passportIdFrom(text: string): string | null {
  return UUID.exec(text)?.[0].toLowerCase() ?? null;
}

export function PassportFinder() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = useCallback((raw: string) => {
    const uid = passportIdFrom(raw);
    if (!uid) {
      setProblem('That is not a ReCircuit passport. A passport ID looks like 8f3c2a1e-…');
      return false;
    }
    navigate(`/unit/${uid}`);
    return true;
  }, [navigate]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    open(text);
  }

  return (
    <section aria-label="Find a passport" className="rounded-md border border-solder bg-tray p-4">
      <h2 className="text-lg font-semibold">Find a passport</h2>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="passport-id">Passport ID</label>
        <input id="passport-id" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a passport ID or link"
               className="min-w-0 flex-1 rounded-md border border-solder bg-white px-3 py-2" />
        <button type="submit" className="rounded-md bg-trace px-4 py-2 font-medium text-white hover:bg-trace-deep">Open passport</button>
        <button type="button" onClick={() => setScanning((s) => !s)} className="rounded-md border border-solder px-4 py-2">
          {scanning ? 'Hide camera' : 'Scan QR code'}
        </button>
      </form>
      {problem && <p role="alert" className="mt-2 text-sm text-fault">{problem}</p>}
      {scanning && (
        <div className="mt-3">
          <QrScanner onScan={(t) => { if (open(t)) setScanning(false); }} onClose={() => setScanning(false)} />
        </div>
      )}
    </section>
  );
}
