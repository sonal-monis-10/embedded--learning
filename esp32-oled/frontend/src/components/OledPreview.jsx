// A pixel-true mirror of the device's 128×64 one-colour OLED for each mode.
// Drawn on the OLED's own pixel grid, so it keeps the screen's 2:1 shape and
// hard pixel edges at any size. Remounting on `mode` replays the wipe.

const DESCRIPTIONS = {
  idle: 'The screen is resting, with sleepy eyes.',
  eyes: 'The screen shows a pair of robot eyes.',
  music: 'The screen shows a spinning disc and song lyrics.',
};

export default function OledPreview({ mode = 'eyes', className = '' }) {
  return (
    <div className={`oled ${className}`}>
      <svg
        key={mode}
        className="oled-pixels"
        viewBox="0 0 128 64"
        shapeRendering="crispEdges"
        role="img"
        aria-label={DESCRIPTIONS[mode] ?? DESCRIPTIONS.eyes}
      >
        {mode === 'idle' && <Resting />}
        {mode === 'music' && <Music />}
        {mode !== 'idle' && mode !== 'music' && <Eyes />}
      </svg>
    </div>
  );
}

function Eyes() {
  return (
    <g>
      <rect x="28" y="18" width="30" height="28" rx="7" />
      <rect x="70" y="18" width="30" height="28" rx="7" />
    </g>
  );
}

function Resting() {
  return (
    <g>
      <rect x="28" y="34" width="30" height="4" rx="2" />
      <rect x="70" y="34" width="30" height="4" rx="2" />
      {/* "z z" drifting up to the right, drawn pixel by pixel */}
      <PixelZ x={102} y={14} size={6} />
      <PixelZ x={112} y={6} size={4} />
    </g>
  );
}

// A Z on the pixel grid: top row, a stepped diagonal, bottom row.
function PixelZ({ x, y, size }) {
  const steps = Array.from({ length: size - 2 }, (_, i) => i + 1);
  return (
    <g>
      <rect x={x} y={y} width={size} height="1" />
      {steps.map((i) => (
        <rect key={i} x={x + size - 1 - i} y={y + i} width="1" height="1" />
      ))}
      <rect x={x} y={y + size - 1} width={size} height="1" />
    </g>
  );
}

function Music() {
  return (
    <g>
      {/* disc: outer ring, label, spindle hole */}
      <circle cx="32" cy="32" r="22" />
      <circle cx="32" cy="32" r="8" fill="var(--oled-off)" />
      <circle cx="32" cy="32" r="2" />
      {/* lyrics: the current line bold, the next lines thin (the OLED has
          no grey, so emphasis is thickness, never brightness) */}
      <rect x="64" y="22" width="52" height="5" rx="1" />
      <rect x="64" y="33" width="38" height="2" />
      <rect x="64" y="41" width="44" height="2" />
    </g>
  );
}
