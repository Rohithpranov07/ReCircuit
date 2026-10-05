import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useModels } from './shared';
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
  const models = useModels();
  const [modelId, setModelId] = useState('');
  const [serial, setSerial] = useState('');

  async function bySerial(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    try {
      const unit = await api<{ passport_uid: string }>(`/units?model_id=${modelId}&serial_no=${encodeURIComponent(serial.trim())}`, { quiet: true });
      navigate(`/unit/${unit.passport_uid}`);
    } catch {
      setProblem('No unit with that model and serial number was found.');
    }
  }

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
    <section aria-label="Find a passport" className="rounded-[24px] bg-limestone p-5">
      <h2 className="h-section">Find a passport</h2>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="passport-id">Passport ID</label>
        <input id="passport-id" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a passport ID or link"
               className="min-w-0 flex-1 rounded-full border-[1.5px] border-obsidian bg-white px-5 py-2.5" />
        <button type="submit" className="rounded-md bg-ember px-6 py-3 text-obsidian hover:bg-obsidian hover:text-chalk">Open passport</button>
        <button type="button" onClick={() => setScanning((s) => !s)} className="rounded-full border-[1.5px] border-obsidian px-6 py-3 hover:bg-obsidian hover:text-chalk">
          {scanning ? 'Hide camera' : 'Scan QR code'}
        </button>
      </form>
      <form onSubmit={(e) => void bySerial(e)} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="by-model">Model</label>
        <select id="by-model" value={modelId} onChange={(e) => setModelId(e.target.value)} className="min-w-0 flex-1 rounded-full border-[1.5px] border-obsidian bg-white px-5 py-2.5">
          <option value="">Or look up by model…</option>
          {(models.data ?? []).map((m) => <option key={m.model_id} value={m.model_id}>{m.model_number}</option>)}
        </select>
        <label className="sr-only" htmlFor="by-serial">Serial number</label>
        <input id="by-serial" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial number" className="min-w-0 flex-1 rounded-full border-[1.5px] border-obsidian bg-white px-5 py-2.5" />
        <button type="submit" disabled={!modelId || !serial.trim()} className="rounded-full border-[1.5px] border-obsidian px-6 py-3 hover:bg-obsidian hover:text-chalk disabled:opacity-50">Look up</button>
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
