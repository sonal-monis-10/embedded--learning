import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronRight, ScanLine } from 'lucide-react';
import OledPreview from '../components/OledPreview.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { ErrorCard, WakingNotice } from '../components/Notice.jsx';
import { connectionProblem } from '../services/messages.js';
import { getMe, logout } from '../services/api.js';
import { clearSession, loadSession } from '../services/session.js';
import { useRequest } from '../services/useRequest.js';

// "/": the devices on this phone's pass, or how to get one.
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
        <h1>{name ? `Hi ${name}` : 'Your devices'}</h1>
      </header>

      {me.slow && <WakingNotice />}
      {me.loading && <div className="card skeleton" aria-label="Loading your devices" />}

      {me.error && (
        <ErrorCard
          title="Could not load your devices"
          action={
            <button type="button" className="btn btn-secondary" onClick={me.reload}>
              Try again
            </button>
          }
        >
          {connectionProblem(me.error)}
        </ErrorCard>
      )}

      {me.data?.devices.length === 0 && (
        <section className="card">
          <h2 className="card-title">Not on any device</h2>
          <p className="card-text">
            You were removed, or you left. Scan a device’s QR code to join it again.
          </p>
        </section>
      )}

      {me.data?.devices.map((device) => (
        <Link key={device.id} to={`/devices/${device.id}`} className="card device-link">
          <OledPreview mode={device.mode} className="oled-small" />
          <span className="device-link-text">
            <span className="device-name">{device.name ?? 'Unnamed screen'}</span>
            <StatusPill device={device} />
          </span>
          <ChevronRight size={22} aria-hidden="true" className="device-link-arrow" />
        </Link>
      ))}

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
