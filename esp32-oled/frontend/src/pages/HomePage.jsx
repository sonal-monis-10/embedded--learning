import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, ScanLine } from 'lucide-react';
import OledPreview from '../components/OledPreview.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { ErrorCard, WakingNotice } from '../components/Notice.jsx';
import { connectionProblem } from '../services/messages.js';
import { getMe, logout } from '../services/api.js';
import { clearSession, loadSession } from '../services/session.js';
import { useRequest } from '../services/useRequest.js';

// "/": the one screen this phone controls, or how to get one.
export default function HomePage() {
  return loadSession() ? <MyDevices /> : <HowToStart />;
}

function HowToStart({ ended = false }) {
  return (
    <div className="page">
      <header className="page-head">
        <p className="brand">OLED Control</p>
        <h1>{ended ? 'Your pass has ended' : 'Play with a little screen'}</h1>
        <p className="lede">
          {ended
            ? 'Passes end at midnight. Scan a device’s QR code to play again.'
            : 'Find the QR code next to a device and scan it with your phone camera.'}
        </p>
      </header>

      <OledPreview mode="idle" className="oled-hero" />

      <section className="card">
        <h2 className="card-title">
          <ScanLine size={22} aria-hidden="true" />
          No camera handy?
        </h2>
        <p className="card-text">You can type the code shown under the QR code instead.</p>
        <Link to="/pair" className="btn btn-secondary">
          Type a code
        </Link>
      </section>
    </div>
  );
}

function MyDevices() {
  const navigate = useNavigate();
  const me = useRequest((opts) => getMe(opts), 'me');
  const [params] = useSearchParams();
  const ended = params.get('ended');
  const [signingOut, setSigningOut] = useState(false);

  if (me.error?.code === 'session_required') return <HowToStart ended />;

  async function signOut() {
    setSigningOut(true);
    await logout().catch(() => {});
    clearSession();
    navigate('/', { replace: true });
  }

  const name = me.data?.user.name ?? loadSession()?.userName;

  return (
    <div className="page">
      <header className="page-head">
        <p className="brand">OLED Control</p>
        <h1>{name ? `Hi ${name}` : 'Your screen'}</h1>
      </header>

      {me.slow && <WakingNotice />}
      {me.loading && <div className="card skeleton" aria-label="Loading your screen" />}

      {me.error && (
        <ErrorCard
          title="Could not load your screen"
          action={
            <button type="button" className="btn btn-secondary" onClick={me.reload}>
              Try again
            </button>
          }
        >
          {connectionProblem(me.error)}
        </ErrorCard>
      )}

      {me.data && !me.data.device && (
        <section className="card">
          <h2 className="card-title">{endedTitle(ended)}</h2>
          <p className="card-text">Scan a screen’s QR code to play again.</p>
          <Link to="/pair" className="btn btn-secondary">
            Type a code
          </Link>
        </section>
      )}

      {me.data?.device && (
        <Link to={`/devices/${me.data.device.id}`} className="card device-link">
          <OledPreview mode={me.data.device.mode} className="oled-small" />
          <span className="device-link-text">
            <span className="device-name">{me.data.device.name ?? 'Unnamed screen'}</span>
            <StatusPill device={me.data.device} />
          </span>
          <ChevronRight size={22} aria-hidden="true" className="device-link-arrow" />
        </Link>
      )}

      {me.data && (
        <footer className="page-foot">
          <p className="muted">Your pass ends at midnight.</p>
          <button type="button" className="text-btn" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out on this phone'}
          </button>
        </footer>
      )}
    </div>
  );
}

// Why the phone no longer controls a screen (?ended= from the device page).
function endedTitle(reason) {
  if (reason === 'left') return 'You left the screen';
  if (reason === 'idle') return 'Your turn ended after a quiet while';
  return 'Not playing with a screen';
}
