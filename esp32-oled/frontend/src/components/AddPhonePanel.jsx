import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { RefreshCw, X } from 'lucide-react';
import { createMemberCode } from '../services/api.js';
import { connectionProblem } from '../services/messages.js';

// "Add a phone": a QR on the owner's screen for someone else to scan.
// Codes work once and for two minutes, so the panel counts down and offers
// a fresh code when it runs out.
export default function AddPhonePanel({ deviceId, onClose }) {
  // Each round asks for a fresh code; "Make a new code" starts the next one.
  const [round, setRound] = useState(0);
  const [result, setResult] = useState({ round: null, pairing: null, qr: null, error: null });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let current = true;
    createMemberCode(deviceId)
      .then(async (pairing) => {
        const qr = await QRCode.toDataURL(pairing.url, {
          margin: 1,
          width: 440,
          color: { dark: '#2b241f' },
        });
        if (current) setResult({ round, pairing, qr, error: null });
      })
      .catch((error) => current && setResult({ round, pairing: null, qr: null, error }));
    return () => {
      current = false;
    };
  }, [deviceId, round]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const settled = result.round === round;
  const pairing = settled ? result.pairing : null;
  const error = settled ? result.error : null;
  const qr = result.qr;
  const secondsLeft = pairing
    ? Math.max(0, Math.round((new Date(pairing.expiresAt) - now) / 1000))
    : 0;
  const expired = pairing && secondsLeft === 0;
  const newCode = () => setRound((n) => n + 1);

  return (
    <section className="card add-phone" aria-labelledby="add-phone-title">
      <div className="card-head">
        <h2 id="add-phone-title" className="card-title">
          Let someone else play
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      {error && <p className="card-text">{connectionProblem(error)}</p>}

      {pairing && !expired && (
        <>
          <p className="card-text">Ask them to point their phone camera at this code.</p>
          <img className="qr" src={qr} alt="QR code to join this device" width="220" height="220" />
          <p className="code-line">
            Or type <strong className="code">{formatCode(pairing.code)}</strong>
          </p>
          <p className="muted" aria-live="polite">
            Works once, for {formatSeconds(secondsLeft)}
          </p>
        </>
      )}

      {(expired || error) && (
        <button type="button" className="btn btn-secondary" onClick={newCode}>
          <RefreshCw size={18} aria-hidden="true" />
          Make a new code
        </button>
      )}

      {!pairing && !error && <div className="qr qr-loading" aria-label="Making a code" />}
    </section>
  );
}

function formatCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function formatSeconds(total) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
