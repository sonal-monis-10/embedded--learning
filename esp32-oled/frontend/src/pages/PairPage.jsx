import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import OledPreview from '../components/OledPreview.jsx';
import { WakingNotice } from '../components/Notice.jsx';
import { connectionProblem } from '../services/messages.js';
import { pair } from '../services/api.js';
import { loadSession, saveSession } from '../services/session.js';

// /pair/:code is where a phone camera lands after scanning a pairing QR.
// /pair (no code) lets someone type the code shown under the QR instead.
export default function PairPage() {
  const { code: codeFromLink } = useParams();
  const navigate = useNavigate();
  const existing = loadSession();

  const [code, setCode] = useState(codeFromLink ?? '');
  const [name, setName] = useState(existing?.userName ?? '');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setSlow(false);
    setError(null);
    try {
      const result = await pair(code, name.trim(), { onSlow: () => setSlow(true) });
      saveSession({
        // An already-paired phone keeps its pass; the server sends no new token.
        token: result.sessionToken ?? existing.token,
        expiresAt: result.expiresAt,
        userId: result.user.id,
        userName: result.user.name,
      });
      navigate(`/devices/${result.device.id}`, { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
      setSlow(false);
    }
  }

  const codeProblem = error?.code === 'invalid_code';

  return (
    <form className="page" onSubmit={submit} noValidate>
      <header className="page-head">
        <p className="brand">OLED Control</p>
        <h1>Play with this screen</h1>
        <p className="lede">
          Type your name and you can control the little screen in front of you until midnight.
        </p>
      </header>

      <OledPreview mode="eyes" className="oled-hero" />

      {!codeFromLink && (
        <div className="field">
          <label htmlFor="code">Code</label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            inputMode="text"
            maxLength={12}
            aria-describedby="code-help"
            aria-invalid={codeProblem || undefined}
            required
          />
          <p id="code-help" className="help">
            The 8 letters and numbers under the QR code, like K3F9-QXW2.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
          maxLength={40}
          aria-describedby="name-help"
          required
        />
        <p id="name-help" className="help">
          Other people on this device will see it.
        </p>
      </div>

      {codeProblem && (
        <div className="inline-error" role="alert">
          <p>This code has run out or was already used. Ask for a fresh QR code.</p>
          {codeFromLink && (
            <Link to="/pair" className="text-link">
              Type a different code
            </Link>
          )}
        </div>
      )}
      {error && !codeProblem && (
        <p className="inline-error" role="alert">
          {connectionProblem(error)}
        </p>
      )}
      {slow && <WakingNotice />}

      <div className="action-bar">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !name.trim() || !code.trim()}
          aria-busy={busy || undefined}
        >
          {busy ? 'Joining…' : 'Start playing'}
        </button>
      </div>
    </form>
  );
}
