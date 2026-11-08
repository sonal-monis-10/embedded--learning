import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Lightbulb, Pencil, Smartphone } from 'lucide-react';
import MusicPanel from '../components/MusicPanel.jsx';
import OledPreview from '../components/OledPreview.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { ErrorCard, WakingNotice } from '../components/Notice.jsx';
import { connectionProblem } from '../services/messages.js';
import { getDevice, leaveDevice, renameDevice, sendCommand, setMode } from '../services/api.js';
import { useLive } from '../services/live.js';
import { loadSession } from '../services/session.js';
import { useRequest } from '../services/useRequest.js';

const MODES = [
  { value: 'idle', label: 'Rest', hint: 'A quiet screen' },
  { value: 'eyes', label: 'Eyes', hint: 'Robot eyes' },
  { value: 'music', label: 'Music', hint: 'Disc and lyrics' },
];

// /devices/:id: control one device. Its screen is mirrored at the top.
export default function DevicePage() {
  const { id } = useParams();
  const session = loadSession();
  const request = useRequest((opts) => getDevice(id, opts), id);

  if (!session || request.error?.code === 'session_required') {
    return (
      <Problem title="Your pass has ended">
        Passes end at midnight. Scan the device’s QR code to play again.
      </Problem>
    );
  }
  if (request.error?.code === 'device_not_found') {
    return (
      <Problem title="This screen is not on your pass">
        Someone else may be using it now. Scan its QR code when it shows one.
      </Problem>
    );
  }

  return (
    <div className="page">
      <nav className="top-nav">
        <Link to="/" className="text-link back-link">
          <ChevronLeft size={20} aria-hidden="true" />
          My screen
        </Link>
      </nav>

      {request.slow && <WakingNotice />}
      {request.loading && <div className="card skeleton skeleton-tall" aria-label="Loading" />}
      {request.error && (
        <ErrorCard
          title="Could not load this device"
          action={
            <button type="button" className="btn btn-secondary" onClick={request.reload}>
              Try again
            </button>
          }
        >
          {connectionProblem(request.error)}
        </ErrorCard>
      )}

      {request.data && (
        <Controls
          device={request.data.device}
          me={session}
          onChange={(update) =>
            request.setData((data) => ({ ...data, device: update(data.device) }))
          }
        />
      )}
    </div>
  );
}

function Controls({ device, me, onChange }) {
  const navigate = useNavigate();
  const [modeState, setModeState] = useState('idle');
  const [modeError, setModeError] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pinged, setPinged] = useState(false);

  const live = useLive({
    onStatus: ({ online, mode }) => onChange((d) => ({ ...d, online, mode })),
    onReleased: (reason) => navigate(`/?ended=${reason}`, { replace: true }),
  });

  async function chooseMode(mode) {
    const previous = device.mode;
    onChange((d) => ({ ...d, mode }));
    setModeState('saving');
    setModeError(null);
    try {
      await setMode(device.id, mode);
      setModeState('saved');
    } catch (err) {
      onChange((d) => ({ ...d, mode: previous }));
      setModeError(err);
      setModeState('idle');
    }
  }

  async function identify() {
    setPinged(true);
    await sendCommand(device.id, { op: 'identify' }).catch(() => {});
    setTimeout(() => setPinged(false), 2000);
  }

  async function leave() {
    live.tilt.stop();
    await leaveDevice(device.id).catch(() => {});
    navigate('/?ended=left', { replace: true });
  }

  return (
    <>
      <header className="page-head">
        <h1>{me.userName ? `Hi ${me.userName}` : 'Your screen'}</h1>
      </header>

      <section className="card screen-card" aria-labelledby="device-name">
        <OledPreview mode={device.mode} className="oled-hero" />
        <DeviceName device={device} onRenamed={(renamed) => onChange(() => renamed)} />
        <StatusPill device={device} />
      </section>

      <section className="card" aria-labelledby="mode-title">
        <h2 id="mode-title" className="card-title">
          What should it show?
        </h2>
        <div className="modes" role="radiogroup" aria-labelledby="mode-title">
          {MODES.map((mode) => (
            <label key={mode.value} className="mode">
              <input
                type="radio"
                name="mode"
                value={mode.value}
                checked={device.mode === mode.value}
                onChange={() => chooseMode(mode.value)}
              />
              <span className="mode-label">{mode.label}</span>
              <span className="mode-hint">{mode.hint}</span>
            </label>
          ))}
        </div>
        <p className="muted mode-state" aria-live="polite">
          {modeState === 'idle' && !modeError && 'Tap one to change what the screen shows.'}
          {modeState === 'saving' && 'Saving…'}
          {modeState === 'saved' &&
            (device.online
              ? 'Showing on the screen now.'
              : 'Saved. The screen will switch when the device connects.')}
          {modeError && connectionProblem(modeError)}
        </p>
      </section>

      {device.mode === 'eyes' && <TiltCard tilt={live.tilt} connected={live.connected} />}
      {device.mode === 'music' && <MusicPanel deviceId={device.id} />}

      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={identify} disabled={pinged}>
          <Lightbulb size={20} aria-hidden="true" />
          {pinged ? 'Look at the screen' : 'Which screen is mine?'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => (confirmLeave ? leave() : setConfirmLeave(true))}
        >
          {confirmLeave ? 'Tap again to leave' : 'Leave this screen'}
        </button>
      </div>
    </>
  );
}

// Eyes mode: stream the phone's tilt so the eyes follow it.
function TiltCard({ tilt, connected }) {
  return (
    <section className="card" aria-labelledby="tilt-title">
      <h2 id="tilt-title" className="card-title">
        <Smartphone size={22} aria-hidden="true" />
        Move the eyes
      </h2>
      {tilt.state === 'unsupported' && (
        <p className="card-text">
          This browser can’t read your phone’s tilt. Try Chrome or Safari on a phone.
        </p>
      )}
      {tilt.state === 'denied' && (
        <p className="card-text">
          Motion access was blocked. Allow “Motion &amp; Orientation” for this site in your browser
          settings, then reload.
        </p>
      )}
      {tilt.state === 'off' && (
        <>
          <p className="card-text">Tilt your phone and the eyes on the screen look the same way.</p>
          <button type="button" className="btn btn-primary" onClick={tilt.start}>
            Start tilting
          </button>
        </>
      )}
      {tilt.state === 'on' && (
        <>
          <p className="card-text" aria-live="polite">
            {connected ? 'Tilt your phone. The eyes follow it.' : 'Reconnecting…'}
          </p>
          <button type="button" className="btn btn-secondary" onClick={tilt.stop}>
            Stop
          </button>
        </>
      )}
    </section>
  );
}

function DeviceName({ device, onRenamed }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name ?? '');
  const [error, setError] = useState(null);

  async function save(event) {
    event.preventDefault();
    try {
      const { device: renamed } = await renameDevice(device.id, name.trim());
      onRenamed(renamed);
      setEditing(false);
    } catch (err) {
      setError(err);
    }
  }

  if (editing) {
    return (
      <form className="rename" onSubmit={save}>
        <label htmlFor="device-name-input" className="sr-only">
          Screen name
        </label>
        <input
          id="device-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoFocus
        />
        <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>
          Save
        </button>
        {error && <p className="inline-error">{connectionProblem(error)}</p>}
      </form>
    );
  }

  return (
    <div className="device-title">
      <h2 id="device-name" className="device-name">
        {device.name ?? 'Unnamed screen'}
      </h2>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setEditing(true)}
        aria-label="Rename this screen"
      >
        <Pencil size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function Problem({ title, children }) {
  return (
    <div className="page">
      <header className="page-head">
        <p className="brand">OLED Control</p>
      </header>
      <OledPreview mode="idle" className="oled-hero" />
      <ErrorCard
        title={title}
        action={
          <Link to="/pair" className="btn btn-secondary">
            Type a code
          </Link>
        }
      >
        {children}
      </ErrorCard>
    </div>
  );
}
