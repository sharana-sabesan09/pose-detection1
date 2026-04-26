// sketch.jsx — hand-drawn primitives (rough boxes, arrows, checkmarks, ticks)
// All drawn with slightly wobbly SVG paths.

const INK = '#1c2632';

// Deterministic pseudo-random based on seed for stable wobble between renders
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Generates a slightly imperfect rectangle path
function roughRectPath(w, h, seed = 7, jitter = 1.4) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * jitter * 2;
  const pts = [
    [j(), j()],
    [w + j(), j()],
    [w + j(), h + j()],
    [j(), h + j()],
  ];
  // bezier between corners with mid-control jitter
  const mid = (a, b) => [(a[0]+b[0])/2 + j()*1.5, (a[1]+b[1])/2 + j()*1.5];
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < 4; i++) {
    const next = pts[(i+1) % 4];
    const m = mid(pts[i], next);
    d += ` Q ${m[0]} ${m[1]}, ${next[0]} ${next[1]}`;
  }
  return d + ' Z';
}

function SketchBox({ children, seed = 4, padding = '14px 16px', style = {}, fill = 'rgba(255,250,235,0.4)', stroke = INK, strokeWidth = 1.6, double = false }) {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState([100, 60]);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => {
      const r = ref.current.getBoundingClientRect();
      setSize([r.width, r.height]);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const [w, h] = size;
  return (
    <div ref={ref} style={{ position: 'relative', padding, ...style }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <path d={roughRectPath(w-2, h-2, seed, 1.6)} transform="translate(1,1)" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
        {double && <path d={roughRectPath(w-4, h-4, seed+13, 1.0)} transform="translate(2,2)" fill="none" stroke={stroke} strokeWidth={strokeWidth*0.6} opacity="0.5" strokeLinejoin="round" />}
      </svg>
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
}

// circle hand-drawn
function SketchCircle({ size = 36, seed = 3, stroke = INK, strokeWidth = 1.6, fill = 'transparent', children, style = {} }) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * 1.2;
  // Generate circle as 4 bezier arcs with jitter
  const cx = size/2, cy = size/2, rad = size/2 - 2;
  const k = 0.5522847498 * rad;
  const d = `
    M ${cx + j()} ${cy - rad + j()}
    C ${cx + k + j()} ${cy - rad + j()}, ${cx + rad + j()} ${cy - k + j()}, ${cx + rad + j()} ${cy + j()}
    C ${cx + rad + j()} ${cy + k + j()}, ${cx + k + j()} ${cy + rad + j()}, ${cx + j()} ${cy + rad + j()}
    C ${cx - k + j()} ${cy + rad + j()}, ${cx - rad + j()} ${cy + k + j()}, ${cx - rad + j()} ${cy + j()}
    C ${cx - rad + j()} ${cy - k + j()}, ${cx - k + j()} ${cy - rad + j()}, ${cx + j()} ${cy - rad + j()} Z
  `;
  return (
    <div style={{ width: size, height: size, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <path d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

// Hand checkmark
function CheckMark({ size = 18, color = INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ overflow: 'visible' }}>
      <path d="M3 13 Q 5 14, 9 19 Q 14 10, 22 4" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Sketch checkbox
function SketchCheck({ checked, onClick, size = 22, label, seed = 9 }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', color: 'inherit', textAlign: 'left' }}>
      <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ overflow: 'visible' }}>
          <path d={roughRectPath(size-2, size-2, seed, 1.0)} transform="translate(1,1)" fill={checked ? INK : 'transparent'} stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {checked && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CheckMark size={size-4} color={'#f3ecdb'} /></span>}
      </span>
      {label && <span style={{ fontFamily: 'Kalam, cursive', fontSize: 16 }}>{label}</span>}
    </button>
  );
}

// Sketch radio
function SketchRadio({ checked, onClick, label, seed = 6 }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', color: 'inherit', textAlign: 'left' }}>
      <SketchCircle size={22} seed={seed} fill="transparent">
        {checked && <SketchCircle size={11} seed={seed+1} fill={INK} stroke={INK} />}
      </SketchCircle>
      {label && <span style={{ fontFamily: 'Kalam, cursive', fontSize: 16 }}>{label}</span>}
    </button>
  );
}

// Squiggle underline
function Squiggle({ width = 80, color = INK, style = {} }) {
  return (
    <svg width={width} height="6" viewBox={`0 0 ${width} 6`} style={{ display: 'block', ...style }}>
      <path d={`M 1 4 Q ${width*0.15} 1, ${width*0.3} 4 T ${width*0.6} 4 T ${width*0.9} 4 T ${width-1} 3.5`} stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Annotation arrow (curved)
function Arrow({ from = [0,0], to = [60, 30], color = INK, width = 200, height = 80, label, labelPos = 'middle' }) {
  const [x1, y1] = from, [x2, y2] = to;
  const cx = (x1+x2)/2 + 18, cy = (y1+y2)/2 - 18;
  const angle = Math.atan2(y2 - cy, x2 - cx);
  const head = 9;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <path d={`M ${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d={`M ${x2} ${y2} L ${x2 - head*Math.cos(angle - 0.5)} ${y2 - head*Math.sin(angle - 0.5)}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d={`M ${x2} ${y2} L ${x2 - head*Math.cos(angle + 0.5)} ${y2 - head*Math.sin(angle + 0.5)}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {label && <text x={cx} y={cy - 4} fontFamily="Caveat" fontSize="17" fill={color}>{label}</text>}
    </svg>
  );
}

// Star
function SketchStar({ size = 20, fill = INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ overflow: 'visible' }}>
      <path d="M12 2 L14.5 9 L22 9.5 L16 14 L18 21 L12 17 L6 21 L8 14 L2 9.5 L9.5 9 Z" fill={fill} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// hand-drawn body silhouette (front view) for joint selection
function BodyDiagram({ selected = [], onToggle, side = 'both' }) {
  // joints: id, label, position
  const joints = [
    { id: 'cervical_flexion', label: 'Neck', cx: 80, cy: 40, lr: 'C' },
    { id: 'shoulder_flexion', label: 'Shoulder', cx: 56, cy: 54, lr: 'L' },
    { id: 'shoulder_flexion_r', label: 'Shoulder', cx: 104, cy: 54, lr: 'R' },
    { id: 'thoracic_flexion', label: 'Upper back', cx: 80, cy: 78, lr: 'C' },
    { id: 'elbow_flexion', label: 'Elbow', cx: 38, cy: 96, lr: 'L' },
    { id: 'elbow_flexion_r', label: 'Elbow', cx: 122, cy: 96, lr: 'R' },
    { id: 'lumbar_flexion', label: 'Lumbar', cx: 80, cy: 118, lr: 'C' },
    { id: 'wrist_flexion', label: 'Wrist', cx: 36, cy: 130, lr: 'L' },
    { id: 'wrist_flexion_r', label: 'Wrist', cx: 124, cy: 130, lr: 'R' },
    { id: 'hip_flexion', label: 'Hip', cx: 64, cy: 148, lr: 'L' },
    { id: 'hip_flexion_r', label: 'Hip', cx: 96, cy: 148, lr: 'R' },
    { id: 'knee_flexion', label: 'Knee', cx: 60, cy: 200, lr: 'L' },
    { id: 'knee_flexion_r', label: 'Knee', cx: 100, cy: 200, lr: 'R' },
    { id: 'ankle_dorsiflexion', label: 'Ankle', cx: 58, cy: 252, lr: 'L' },
    { id: 'ankle_dorsiflexion_r', label: 'Ankle', cx: 102, cy: 252, lr: 'R' },
  ];
  return (
    <svg viewBox="0 0 160 280" style={{ width: '100%', maxWidth: 220, overflow: 'visible' }}>
      {/* head */}
      <ellipse cx="80" cy="22" rx="14" ry="16" fill="rgba(255,250,235,0.3)" stroke={INK} strokeWidth="1.4" />
      {/* neck */}
      <path d="M 74 36 L 74 44 M 86 36 L 86 44" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* torso */}
      <path d="M 60 46 Q 56 80, 58 110 Q 56 128, 62 142 L 98 142 Q 104 128, 102 110 Q 104 80, 100 46 Q 92 42, 80 42 Q 68 42, 60 46 Z" fill="rgba(255,250,235,0.3)" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      {/* arms */}
      <path d="M 60 50 Q 42 70, 38 100 Q 36 116, 40 128" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 100 50 Q 118 70, 122 100 Q 124 116, 120 128" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      {/* legs */}
      <path d="M 64 142 Q 60 180, 58 220 Q 56 244, 56 262" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 78 142 Q 76 180, 76 220 Q 74 244, 70 262" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 82 142 Q 84 180, 84 220 Q 86 244, 90 262" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 96 142 Q 100 180, 102 220 Q 104 244, 104 262" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      {/* feet */}
      <path d="M 50 264 Q 48 270, 56 268 L 64 264" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 110 264 Q 112 270, 104 268 L 96 264" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />

      {joints.map(j => {
        const realId = j.id.replace('_r', '');
        const isSel = selected.includes(j.id) || selected.includes(realId);
        const inactive = (side === 'left' && j.lr === 'R') || (side === 'right' && j.lr === 'L');
        return (
          <g key={j.id} onClick={() => !inactive && onToggle(j.id)} style={{ cursor: inactive ? 'default' : 'pointer', opacity: inactive ? 0.25 : 1 }}>
            <circle cx={j.cx} cy={j.cy} r="9" fill={isSel ? INK : 'rgba(255,250,235,0.9)'} stroke={INK} strokeWidth="1.4" />
            {isSel && <circle cx={j.cx} cy={j.cy} r="3" fill="#f3ecdb" />}
          </g>
        );
      })}
    </svg>
  );
}

Object.assign(window, { SketchBox, SketchCircle, SketchCheck, SketchRadio, CheckMark, Squiggle, Arrow, SketchStar, BodyDiagram, INK });
