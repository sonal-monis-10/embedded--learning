import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Pencil, UserPlus, X } from 'lucide-react';
import AddPhonePanel from '../components/AddPhonePanel.jsx';
import OledPreview from '../components/OledPreview.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { ErrorCard, WakingNotice } from '../components/Notice.jsx';
import { connectionProblem } from '../services/messages.js';
import { getDevice, removeMember, renameDevice, setMode } from '../services/api.js';
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
        Scan the QR code next to it to join, or ask its owner to add your phone.
      </Problem>
    );
  }

  return (
    <div className="page">
      <nav className="top-nav">
        <Link to="/" className="text-link back-link">
          <ChevronLeft size={20} aria-hidden="true" />
          My devices
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
          members={request.data.members}
          me={session}
          onChange={(device) => request.setData((data) => ({ ...data, device }))}
          onMembersChange={(members) => request.setData((data) => ({ ...data, members }))}
        />
      )}
    </div>
  );
}

function Controls({ device, members, me, onChange, onMembersChange }) {
  const navigate = useNavigate();
  const isOwner = device.role === 'owner';
  const [modeState, setModeState] = useState('idle');
  const [modeError, setModeError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function chooseMode(mode) {
    const previous = device.mode;
    onChange({ ...device, mode });
    setModeState('saving');
    setModeError(null);
    try {
      await setMode(device.id, mode);
      setModeState('saved');
    } catch (err) {
      onChange({ ...device, mode: previous });
      setModeError(err);
      setModeState('idle');
    }
  }

  async function remove(member) {
    await removeMember(device.id, member.id);
    if (member.id === me.userId) {
      navigate('/', { replace: true });
    } else {
      onMembersChange(members.filter((m) => m.id !== member.id));
    }
  }

  const you = members.find((m) => m.id === me.userId);

  return (
    <>
      <header className="page-head">
        <h1>{me.userName ? `Hi ${me.userName}` : 'Your screen'}</h1>
      </header>

      <section className="card screen-card" aria-labelledby="device-name">
        <OledPreview mode={device.mode} className="oled-hero" />
        <DeviceName device={device} isOwner={isOwner} onRenamed={onChange} />
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

      {adding && <AddPhonePanel deviceId={device.id} onClose={() => setAdding(false)} />}

      <section className="card" aria-labelledby="people-title">
        <h2 id="people-title" className="card-title">
          People playing
        </h2>
        <ul className="people">
          {members.map((member) => (
            <li key={member.id} className="person">
              <span className="person-name">
                {member.name}
                {member.id === me.userId && <span className="muted"> (you)</span>}
              </span>
              <span className="person-meta">
                {member.role === 'owner' ? 'Owner' : 'Playing'} since {formatTime(member.joinedAt)}
              </span>
              {isOwner && member.id !== me.userId && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => remove(member)}
                  aria-label={`Remove ${member.name}`}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="action-bar">
        {isOwner && !adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <UserPlus size={20} aria-hidden="true" />
            Add a phone
          </button>
        )}
        {!isOwner && you && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => (confirmLeave ? remove(you) : setConfirmLeave(true))}
          >
            {confirmLeave ? 'Tap again to leave' : 'Leave this screen'}
          </button>
        )}
      </div>
    </>
  );
}

function DeviceName({ device, isOwner, onRenamed }) {
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
      {isOwner && (
        <button
          type="button"
          className="icon-btn"
          onClick={() => setEditing(true)}
          aria-label="Rename this screen"
        >
          <Pencil size={18} aria-hidden="true" />
        </button>
      )}
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

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
