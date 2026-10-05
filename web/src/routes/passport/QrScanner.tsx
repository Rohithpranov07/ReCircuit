import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';

/** Camera scanner. Reports the decoded text once, then stops. Typing the passport ID is the fallback. */
export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(false);
  const callback = useRef(onScan);
  useEffect(() => { callback.current = onScan; });

  useEffect(() => {
    const scanner = new Html5Qrcode('qr-reader');
    scanner
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
             (text) => {
               if (done.current) return;
               done.current = true;
               callback.current(text);
             }, undefined)
      .catch(() => setProblem('The camera is not available. Type or paste the passport ID instead.'));
    return () => {
      if (scanner.isScanning) void scanner.stop().then(() => scanner.clear());
    };
  }, []);

  return (
    <div className="rounded-[24px] bg-limestone p-4">
      <div id="qr-reader" className="mx-auto w-full max-w-sm" />
      {problem && <p role="alert" className="mt-2 text-sm text-fault">{problem}</p>}
      <button type="button" onClick={onClose} className="mt-3 rounded-full border-[1.5px] border-obsidian px-5 py-2 text-sm">Close scanner</button>
    </div>
  );
}
