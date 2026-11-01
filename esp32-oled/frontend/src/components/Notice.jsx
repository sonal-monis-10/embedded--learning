import { CircleAlert, Hourglass } from 'lucide-react';

// The server is on a free plan and sleeps; say so instead of spinning.
export function WakingNotice() {
  return (
    <p className="notice" role="status">
      <Hourglass size={18} aria-hidden="true" />
      Waking up the server. The first visit can take up to a minute.
    </p>
  );
}

// An error card that says what happened and what to do next.
export function ErrorCard({ title, children, action }) {
  return (
    <section className="card error-card" role="alert">
      <h2 className="card-title">
        <CircleAlert size={22} aria-hidden="true" />
        {title}
      </h2>
      <div className="card-text">{children}</div>
      {action}
    </section>
  );
}
