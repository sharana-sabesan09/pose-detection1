// main.jsx — Home, Session, Movements library, Doctor review, Return summary, Profile

// ── HOME / DASHBOARD ────────────────────────────────────────
function ScreenHome({ profile, onStart, onMovements, onDoctor, onReturn, onProfile }) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="screen paper">
      {/* decorative loose elements that bleed across the page */}
      <HomeBackdrop />

      <div className="screen-scroll" style={{ paddingTop: 60, position: 'relative', zIndex: 1 }}>
        {/* top row: hello + profile */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div className="h-hand" style={{ fontSize: 14, color: INK_3 }}>{greeting},</div>
            <div className="h-display" style={{ fontSize: 40, lineHeight: 1, transform: 'rotate(-1deg)' }}>
              {profile.name || 'friend'}
              <span style={{ color: 'oklch(0.62 0.14 35)' }}>.</span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Squiggle width={120} color="oklch(0.62 0.14 35)" />
              <span className="h-hand" style={{ fontSize: 12, color: INK_3 }}>day 24 of recovery</span>
            </div>
          </div>
          <button onClick={onProfile} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative' }}>
            <SketchCircle size={54} seed={5} fill="oklch(0.92 0.05 70 / 0.7)" stroke={INK} strokeWidth={1.8}>
              <span className="h-display" style={{ fontSize: 24 }}>{(profile.name || 'me').slice(0, 1).toUpperCase()}</span>
            </SketchCircle>
            {/* notification dot */}
            <div style={{ position: 'absolute', top: -2, right: -2 }}>
              <SketchCircle size={16} seed={888} fill="oklch(0.62 0.14 35)" stroke="oklch(0.32 0.1 35)" strokeWidth={1.4}>
                <span className="h-display" style={{ fontSize: 10, color: '#f3ecdb' }}>2</span>
              </SketchCircle>
            </div>
          </button>
        </div>

        {/* primary CTA */}
        <div style={{ marginTop: 28, position: 'relative' }}>
          <button onClick={onStart} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit', color: 'inherit' }}>
            <SketchBox seed={3} padding="20px 22px 18px" fill={INK} stroke={INK} strokeWidth={2}>
              <div style={{ color: '#f3ecdb', position: 'relative' }}>
                <div className="h-hand" style={{ fontSize: 13, opacity: 0.7, letterSpacing: 1.5 }}>TODAY · TUE</div>
                <div className="h-display" style={{ fontSize: 42, lineHeight: 1, marginTop: 2 }}>Start session</div>
                {/* mini movement strip */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', marginTop: 14, alignItems: 'center' }}>
                  {['Step-up', 'Side plank'].map((m, i) => (
                    <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: i === 0 ? 'oklch(0.78 0.13 70)' : 'rgba(243,236,219,0.45)' }} />
                      <span className="h-hand" style={{ fontSize: 12, opacity: i === 0 ? 1 : 0.6 }}>{m}</span>
                    </div>
                  ))}
                  <span className="h-hand" style={{ fontSize: 12, opacity: 0.55 }}>+ 2 more</span>
                </div>
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <SketchCircle size={36} seed={9} stroke="#f3ecdb" fill="rgba(243,236,219,0.08)">
                    <svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 4 L 20 12 L 5 20 Z" fill="#f3ecdb"/></svg>
                  </SketchCircle>
                  <span className="h-hand" style={{ fontSize: 14, opacity: 0.85, flex: 1 }}>~12 min · camera ready</span>
                  <span className="h-display" style={{ fontSize: 22, color: 'oklch(0.78 0.13 70)' }}>4 <span className="h-hand" style={{ fontSize: 11, opacity: 0.7 }}>moves</span></span>
                </div>
              </div>
            </SketchBox>
          </button>
          {/* tilted streak callout — moved above the card so it doesn't overlap content */}
          <div style={{ position: 'absolute', top: -16, left: 14, transform: 'rotate(-3deg)', pointerEvents: 'none' }}>
            <SketchBox seed={777} padding="2px 10px" fill="oklch(0.78 0.13 70)" stroke="oklch(0.32 0.1 70)" strokeWidth={1.6}>
              <span className="h-display" style={{ fontSize: 16, color: 'oklch(0.25 0.08 70)' }}>3-day streak ★</span>
            </SketchBox>
          </div>
        </div>

        {/* metric strip — colored */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
          <SketchBox seed={14} padding="14px" fill="oklch(0.95 0.04 35 / 0.55)" stroke="oklch(0.48 0.13 35)" strokeWidth={1.4}>
            <div className="h-hand" style={{ fontSize: 11, color: 'oklch(0.42 0.1 35)', letterSpacing: 1.2 }}>RE-INJURY RISK</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span className="h-display" style={{ fontSize: 38, color: 'oklch(0.52 0.16 35)', lineHeight: 1 }}>14<span style={{ fontSize: 16, color: 'oklch(0.42 0.1 35)' }}>%</span></span>
            </div>
            {/* tiny sparkline */}
            <svg width="100%" height="20" viewBox="0 0 100 20" preserveAspectRatio="none" style={{ marginTop: 4 }}>
              <path d="M 2 6 Q 15 8, 25 12 T 50 9 T 75 14 T 98 16" stroke="oklch(0.62 0.14 35)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              <circle cx="98" cy="16" r="2.5" fill="oklch(0.52 0.16 35)" />
            </svg>
            <div className="h-hand" style={{ fontSize: 11, color: 'oklch(0.42 0.1 35)', marginTop: 2 }}>↓ 3% this week</div>
          </SketchBox>
          <SketchBox seed={28} padding="14px" fill="oklch(0.93 0.05 145 / 0.5)" stroke="oklch(0.42 0.12 145)" strokeWidth={1.4}>
            <div className="h-hand" style={{ fontSize: 11, color: 'oklch(0.32 0.1 145)', letterSpacing: 1.2 }}>SESSIONS DONE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span className="h-display" style={{ fontSize: 38, color: 'oklch(0.42 0.14 145)', lineHeight: 1 }}>9</span>
              <span className="h-hand" style={{ fontSize: 12, color: 'oklch(0.32 0.1 145)' }}>/ 12</span>
            </div>
            {/* progress dots */}
            <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
              {Array.from({length: 12}).map((_, i) => (
                <div key={i} style={{ width: 10, height: 10 }}>
                  <SketchCircle size={10} seed={40+i} stroke="oklch(0.32 0.1 145)" fill={i < 9 ? 'oklch(0.62 0.13 145)' : 'transparent'} strokeWidth={1.1} />
                </div>
              ))}
            </div>
          </SketchBox>
        </div>

        {/* TODAY'S PAIN check-in — playful inline strip */}
        <div style={{ marginTop: 14 }}>
          <SketchBox seed={222} padding="12px 14px" fill="oklch(0.94 0.04 70 / 0.55)" stroke="oklch(0.42 0.1 70)" strokeWidth={1.4}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="h-hand" style={{ fontSize: 11, color: 'oklch(0.32 0.08 70)', letterSpacing: 1.2 }}>HOW'S YOUR KNEE TODAY?</div>
                <div className="h-display" style={{ fontSize: 18, color: 'oklch(0.32 0.08 70)' }}>tap to log</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {['◠‿◠','◡◡','◔◔','◠︿◠'].map((f, i) => (
                  <button key={i} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    <SketchCircle size={32} seed={300+i} stroke="oklch(0.42 0.1 70)" fill="oklch(0.96 0.02 70 / 0.7)" strokeWidth={1.3}>
                      <span className="h-display" style={{ fontSize: 13 }}>{f}</span>
                    </SketchCircle>
                  </button>
                ))}
              </div>
            </div>
          </SketchBox>
        </div>

        {/* nav cards */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 }}>
          <span className="h-hand" style={{ fontSize: 12, color: INK_3, letterSpacing: 1.5 }}>EXPLORE</span>
          <Squiggle width={50} />
        </div>

        <NavCard onClick={onMovements} title="See all movements" sub="Library of exercises in your plan" icon={<MovementsIcon />} seed={55} tint="blue" />
        <NavCard onClick={onDoctor} title="Reviewed by your doctor" sub="2 new notes from Dr. Adler" icon={<DoctorIcon />} seed={61} tint="terracotta" badge="2 new" />
        <NavCard onClick={onReturn} title="Return after session" sub="Log how it felt · pain · notes" icon={<ReturnIcon />} seed={68} tint="green" />

        {/* footer with little hand-drawn flourish */}
        <div style={{ textAlign: 'center', marginTop: 28, paddingBottom: 8 }} className="h-hand">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Squiggle width={28} color="oklch(0.62 0.14 35)" />
            <span style={{ fontSize: 13, color: INK_FAINT }}>asking for help is the first step</span>
            <Squiggle width={28} color="oklch(0.62 0.14 35)" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Decorative backdrop: faint loose marks bleeding across the home page
function HomeBackdrop() {
  return (
    <svg viewBox="0 0 390 780" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.7 }}>
      {/* warm corner wash */}
      <defs>
        <radialGradient id="warmWash" cx="0.85" cy="0.05" r="0.6">
          <stop offset="0%" stopColor="oklch(0.85 0.1 60)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="oklch(0.85 0.1 60)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="coolWash" cx="0.05" cy="1" r="0.7">
          <stop offset="0%" stopColor="oklch(0.78 0.1 220)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="oklch(0.78 0.1 220)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="390" height="780" fill="url(#warmWash)" />
      <rect width="390" height="780" fill="url(#coolWash)" />
      {/* loose marks */}
      <path d="M -10 130 Q 80 125, 180 135 T 400 130" stroke="oklch(0.62 0.14 35)" strokeWidth="1" strokeOpacity="0.18" fill="none" />
      <path d="M -10 145 Q 90 140, 200 148 T 400 145" stroke="oklch(0.62 0.14 35)" strokeWidth="1" strokeOpacity="0.12" fill="none" />
      {/* dotted side margin */}
      <path d="M 18 80 L 18 720" stroke="oklch(0.62 0.14 35)" strokeWidth="1" strokeOpacity="0.25" strokeDasharray="2 6" fill="none" />
      {/* corner doodle: small sun */}
      <g transform="translate(340, 70)" opacity="0.35">
        <circle cx="0" cy="0" r="8" stroke="oklch(0.55 0.16 70)" strokeWidth="1.2" fill="oklch(0.92 0.08 70)" />
        {Array.from({length: 8}).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const x1 = Math.cos(a) * 12, y1 = Math.sin(a) * 12;
          const x2 = Math.cos(a) * 17, y2 = Math.sin(a) * 17;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="oklch(0.55 0.16 70)" strokeWidth="1.2" strokeLinecap="round" />;
        })}
      </g>
      {/* corner doodle: tiny plant bottom-right */}
      <g transform="translate(340, 700)" opacity="0.28">
        <path d="M 0 20 Q -8 5, -4 -10" stroke="oklch(0.42 0.12 145)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M -4 -10 Q -10 -12, -12 -6" stroke="oklch(0.42 0.12 145)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M -4 -10 Q 2 -14, 6 -8" stroke="oklch(0.42 0.12 145)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M 0 20 L 0 25" stroke="oklch(0.42 0.12 145)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      {/* paperclip flourish near top-left */}
      <g transform="translate(28, 60) rotate(-25)" opacity="0.4">
        <path d="M 0 0 L 0 18 Q 0 22, 4 22 Q 8 22, 8 18 L 8 4" stroke={INK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M 4 4 L 4 16" stroke={INK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function NavCard({ onClick, title, sub, icon, seed, tint, badge }) {
  const tints = {
    terracotta: { fill: 'oklch(0.92 0.05 35 / 0.55)', stroke: 'oklch(0.48 0.13 35)' },
    green:      { fill: 'oklch(0.93 0.05 145 / 0.5)', stroke: 'oklch(0.42 0.12 145)' },
    blue:       { fill: 'oklch(0.93 0.04 230 / 0.5)', stroke: 'oklch(0.42 0.1 230)' },
    plain:      { fill: 'rgba(255,250,235,0.45)', stroke: INK },
  };
  const t = tints[tint] || tints.plain;
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', marginBottom: 10 }}>
      <SketchBox seed={seed} padding="14px 16px" fill={t.fill} stroke={t.stroke} strokeWidth={1.5}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flexShrink: 0 }}>{icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h-display" style={{ fontSize: 22, lineHeight: 1.05 }}>{title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              <div className="h-hand" style={{ fontSize: 13, color: INK_3 }}>{sub}</div>
              {badge && (
                <span className="h-hand" style={{ fontSize: 10, padding: '2px 8px', background: 'oklch(0.62 0.14 35)', color: '#f3ecdb', borderRadius: 8, letterSpacing: 0.5 }}>{badge}</span>
              )}
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d="M8 4 Q 17 11, 20 12 Q 17 13, 8 20" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </SketchBox>
    </button>
  );
}

function MovementsIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44">
      <circle cx="14" cy="14" r="5" stroke={INK} strokeWidth="1.6" fill="none" />
      <path d="M 14 19 L 14 30 M 9 22 L 19 22 M 14 30 L 9 38 M 14 30 L 19 38" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 28 18 Q 36 15, 40 22 Q 36 29, 28 26" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 30 32 Q 36 30, 40 36" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function DoctorIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44">
      <rect x="6" y="8" width="32" height="30" rx="2" stroke={INK} strokeWidth="1.6" fill="none" />
      <path d="M 22 12 L 22 24 M 16 18 L 28 18" stroke="oklch(0.48 0.13 35)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M 12 30 L 24 30 M 12 34 L 20 34" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function ReturnIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44">
      <path d="M 8 22 Q 14 8, 28 12 Q 38 18, 32 30 Q 22 38, 12 32" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M 12 32 L 7 28 M 12 32 L 14 25" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ── SESSION (LIVE) ──────────────────────────────────────────
function ScreenSession({ onBack, onEnd }) {
  const [recording, setRecording] = React.useState(false);
  const [t, setT] = React.useState(0);
  const [mode, setMode] = React.useState('standing');
  React.useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setT(x => x+1), 1000);
    return () => clearInterval(id);
  }, [recording]);
  const scores = {
    balance: 78, gait: recording ? 64 : 70, sway: recording ? 55 : 62, fall: 31,
  };
  return (
    <div className="screen" style={{ background: '#1a1f25' }}>
      {/* simulated camera viewport */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #2a323b 0%, #1a1f25 70%)' }}>
        {/* sketchy room outline */}
        <svg viewBox="0 0 380 800" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M 0 540 Q 190 555, 380 540" stroke="rgba(243,236,219,0.18)" strokeWidth="1.2" fill="none" />
          <path d="M 60 360 L 60 540 M 320 360 L 320 540" stroke="rgba(243,236,219,0.12)" strokeWidth="1" fill="none" />
          {/* skeleton overlay */}
          <g stroke="oklch(0.85 0.14 70)" strokeWidth="2" fill="none" strokeLinecap="round">
            <circle cx="190" cy="280" r="22" />
            <line x1="190" y1="302" x2="190" y2="430" />
            <line x1="190" y1="320" x2="148" y2="380" />
            <line x1="148" y1="380" x2="135" y2="450" />
            <line x1="190" y1="320" x2="232" y2="380" />
            <line x1="232" y1="380" x2="245" y2="450" />
            <line x1="190" y1="430" x2="170" y2="540" />
            <line x1="170" y1="540" x2="160" y2="640" />
            <line x1="190" y1="430" x2="210" y2="540" />
            <line x1="210" y1="540" x2="220" y2="640" />
          </g>
          <g fill="oklch(0.62 0.14 35)">
            {[
              [190,302],[190,320],[148,380],[135,450],[232,380],[245,450],
              [190,430],[170,540],[160,640],[210,540],[220,640]
            ].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="4" />)}
          </g>
        </svg>
      </div>

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* top bar */}
        <div style={{ paddingTop: 60, padding: '60px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'rgba(243,236,219,0.12)', border: 'none', borderRadius: 24, width: 40, height: 40, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M16 4 Q 7 11, 4 12 Q 7 13, 16 20" stroke="#f3ecdb" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="h-display" style={{ flex: 1, color: '#f3ecdb', fontSize: 24 }}>Session</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', background: recording ? 'oklch(0.58 0.18 25 / 0.25)' : 'oklch(0.62 0.13 145 / 0.2)', border: `1.5px solid ${recording ? 'oklch(0.58 0.18 25)' : 'oklch(0.62 0.13 145)'}`, borderRadius: 20 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: recording ? 'oklch(0.58 0.18 25)' : 'oklch(0.62 0.13 145)' }} />
            <span className="h-hand" style={{ fontSize: 12, color: recording ? 'oklch(0.78 0.14 25)' : 'oklch(0.78 0.13 145)' }}>{recording ? `REC ${t}s` : 'LIVE'}</span>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* live scores card */}
        <div style={{ padding: '0 14px' }}>
          <SketchBox seed={111} padding="14px 16px" fill="rgba(243,236,219,0.92)">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span className="h-display" style={{ fontSize: 22 }}>Live scores</span>
              <span className="h-hand" style={{ fontSize: 12, color: INK_3 }}>updates 30×/sec</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ScoreBar label="Balance" value={scores.balance} />
              <ScoreBar label="Gait" value={scores.gait} />
              <ScoreBar label="Sway" value={scores.sway} />
              <ScoreBar label="Fall risk" value={scores.fall} inverse />
            </div>
          </SketchBox>
        </div>

        {/* record bar */}
        <div style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={() => setRecording(r => !r)} className="btn-ink" style={{ flex: 1, background: recording ? 'oklch(0.58 0.18 25)' : INK }}>
              <span style={{ fontSize: 18 }}>{recording ? '■' : '⬤'}</span>
              {recording ? `Stop · ${60-t}s left` : 'Record 60s'}
            </button>
            <button onClick={onEnd} className="btn-ink" style={{ background: 'rgba(243,236,219,0.92)', color: INK }}>End ✓</button>
          </div>
        </div>

        {/* mode selector */}
        <div style={{ padding: '0 14px 16px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{id:'standing',l:'Standing',s:'Balance'},{id:'transition',l:'Sit ↔ Stand',s:'Transition'},{id:'walking',l:'Walking',s:'Gait'}].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{ flex: 1, background: mode === m.id ? 'rgba(243,236,219,0.92)' : 'rgba(243,236,219,0.12)', border: '1.5px solid rgba(243,236,219,0.35)', borderRadius: 12, padding: '8px 6px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <div className="h-display" style={{ fontSize: 16, color: mode === m.id ? INK : '#f3ecdb' }}>{m.l}</div>
                <div className="h-hand" style={{ fontSize: 10, color: mode === m.id ? INK_3 : 'rgba(243,236,219,0.55)', letterSpacing: 1 }}>{m.s}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, inverse }) {
  const good = inverse ? value < 30 : value >= 70;
  const warn = inverse ? value < 50 : value >= 50;
  const color = good ? 'oklch(0.62 0.13 145)' : warn ? 'oklch(0.74 0.14 75)' : 'oklch(0.58 0.18 25)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 0.5 }}>{label}</span>
        <span className="h-display" style={{ fontSize: 20, color }}>{value}</span>
      </div>
      <svg width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none">
        <path d="M 1 4 Q 50 6, 99 4" stroke="rgba(28,38,50,0.2)" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d={`M 1 4 Q ${value/2} 6, ${value} 4`} stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ── MOVEMENTS LIBRARY ───────────────────────────────────────
function ScreenMovements({ onBack }) {
  const [filter, setFilter] = React.useState('all');
  const moves = [
    { id: 1, name: 'Mini squat', joint: 'knee', sets: '3 × 12', diff: 'easy', done: true },
    { id: 2, name: 'Heel raises', joint: 'ankle', sets: '3 × 15', diff: 'easy', done: true },
    { id: 3, name: 'Single-leg balance', joint: 'ankle', sets: '3 × 30s', diff: 'med', done: true },
    { id: 4, name: 'Step-up to bench', joint: 'knee', sets: '3 × 10', diff: 'med', done: false, today: true },
    { id: 5, name: 'Side plank (mod.)', joint: 'core', sets: '2 × 30s', diff: 'med', done: false, today: true },
    { id: 6, name: 'Bulgarian split squat', joint: 'knee', sets: '3 × 8', diff: 'hard', done: false },
    { id: 7, name: 'Hip airplane', joint: 'hip', sets: '3 × 6', diff: 'hard', done: false },
  ];
  const filtered = filter === 'all' ? moves : filter === 'today' ? moves.filter(m => m.today) : moves.filter(m => m.joint === filter);
  return (
    <div className="screen paper">
      <ScreenHeader onBack={onBack} title="Movements" sub="your prescribed library" />
      <div style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            {id:'all', l:'All'}, {id:'today', l:'Today'},
            {id:'knee', l:'Knee'}, {id:'hip', l:'Hip'}, {id:'ankle', l:'Ankle'}, {id:'core', l:'Core'},
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`tag-pill ${filter === f.id ? 'active' : ''}`} style={{ cursor: 'pointer' }}>{f.l}</button>
          ))}
        </div>
      </div>
      <div className="screen-scroll" style={{ paddingTop: 0 }}>
        {filtered.map((m, i) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <SketchBox seed={120+i*5} padding="12px 14px" fill={m.today ? 'oklch(0.88 0.06 35 / 0.4)' : 'rgba(255,250,235,0.45)'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <SketchCircle size={42} seed={130+i} fill={m.done ? INK : 'rgba(255,250,235,0.7)'}>
                  {m.done ? <CheckMark size={20} color="#f3ecdb" /> : <span className="h-display" style={{ fontSize: 18 }}>{m.id}</span>}
                </SketchCircle>
                <div style={{ flex: 1 }}>
                  <div className="h-display" style={{ fontSize: 22, lineHeight: 1.05, textDecoration: m.done ? 'line-through' : 'none', textDecorationStyle: 'wavy', textDecorationColor: INK_FAINT }}>{m.name}</div>
                  <div className="h-hand" style={{ fontSize: 13, color: INK_3, marginTop: 2, display: 'flex', gap: 10 }}>
                    <span>{m.sets}</span>
                    <span>·</span>
                    <span>{m.joint}</span>
                    {m.today && <span style={{ color: 'oklch(0.48 0.13 35)' }}>· today</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1,2,3].map(d => <SketchStar key={d} size={11} fill={d <= ({easy:1,med:2,hard:3})[m.diff] ? INK : 'transparent'} />)}
                </div>
              </div>
            </SketchBox>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DOCTOR REVIEW ───────────────────────────────────────────
function ScreenDoctorReview({ onBack }) {
  return (
    <div className="screen paper">
      <ScreenHeader onBack={onBack} title="From Dr. Adler" sub="reviewed Apr 22" />
      <div className="screen-scroll" style={{ paddingTop: 0 }}>
        <SketchBox seed={222} padding="16px 18px" fill="rgba(255,250,235,0.5)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <SketchCircle size={48} seed={223} fill="rgba(28,38,50,0.06)">
              <span className="h-display" style={{ fontSize: 22 }}>A</span>
            </SketchCircle>
            <div>
              <div className="h-display" style={{ fontSize: 22, lineHeight: 1 }}>Dr. M. Adler</div>
              <div className="h-hand" style={{ fontSize: 12, color: INK_3 }}>orthopaedic PT · Boston</div>
            </div>
            <div style={{ flex: 1 }} />
            <span className="tag-pill accent">2 new</span>
          </div>
          <Squiggle width={120} />
          <div className="h-hand" style={{ fontSize: 16, lineHeight: 1.55, color: INK_2, marginTop: 12 }}>
            Strong week — gait regularity is up to <span className="scribble-under">82</span> from 71. The lateral
            sway during your walking sets is the next thing to chip at. I'd
            like you to add the hip airplane drill before squats. Reduce step-up
            height to 12 cm until pain settles below 3/10.
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="tag-pill">+ Hip airplane</span>
            <span className="tag-pill">↓ Step-up height</span>
            <span className="tag-pill">Pain target ≤ 3</span>
          </div>
        </SketchBox>

        <div className="h-hand" style={{ fontSize: 12, color: INK_3, letterSpacing: 1.5, margin: '22px 0 10px' }}>EARLIER NOTES</div>

        {[
          { date: 'Apr 15', body: 'Knee flexion ROM looking good. Cleared for full body-weight squat to 90°.' },
          { date: 'Apr 08', body: 'Reduce single-leg balance time to 20s. Form > duration.' },
          { date: 'Mar 31', body: 'Welcome aboard. Phase: sub-acute. Hold compressive sleeve during ADLs.' },
        ].map((n, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <SketchBox seed={300 + i*7} padding="12px 14px" fill="rgba(255,250,235,0.4)">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="h-display" style={{ fontSize: 18 }}>{n.date}</span>
                <span className="h-hand" style={{ fontSize: 11, color: INK_FAINT, letterSpacing: 1 }}>NOTE</span>
              </div>
              <div className="h-hand" style={{ fontSize: 14, lineHeight: 1.5, color: INK_2 }}>{n.body}</div>
            </SketchBox>
          </div>
        ))}

        <div style={{ marginTop: 14 }}>
          <button className="btn-ink" style={{ width: '100%', background: 'transparent', color: INK, border: `1.6px solid ${INK}` }}>
            Send a message to Dr. Adler ↗
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RETURN AFTER SESSION (post-session intake) ──────────────
function ScreenReturn({ onBack, onDone, profile }) {
  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState({
    session_type: 'treatment',
    overall_feel: null,
    pain: { knee_flexion: 0, hip_flexion: 0 },
    pt_plan: '',
    notes: '',
  });
  const set = (p) => setData(d => ({ ...d, ...p }));
  const setPain = (joint, v) => setData(d => ({ ...d, pain: { ...d.pain, [joint]: v } }));

  if (step === 0) {
    return (
      <div className="screen paper">
        <ScreenHeader onBack={onBack} title="How did it go?" sub="quick check-in" />
        <div className="screen-scroll" style={{ paddingTop: 0 }}>
          <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 8 }}>WHAT KIND OF SESSION?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
            {[
              { id: 'treatment', l: 'Treatment', s: 'Standard rehab session' },
              { id: 'assessment', l: 'Assessment', s: 'Formal measurement / baseline' },
              { id: 'home_exercise_check', l: 'Home check-in', s: 'Solo, limited camera data' },
            ].map(t => (
              <button key={t.id} onClick={() => set({ session_type: t.id })} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
                <SketchBox seed={t.id.length + 33} padding="10px 14px" fill={data.session_type === t.id ? 'rgba(28,38,50,0.06)' : 'rgba(255,250,235,0.4)'}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'inline-flex' }}>
                      <SketchCircle size={22} seed={t.id.length + 9} stroke={INK} fill={data.session_type === t.id ? INK : 'transparent'} strokeWidth={1.6}>
                        {data.session_type === t.id && <CheckMark size={12} color="#f3ecdb" />}
                      </SketchCircle>
                    </span>
                    <div>
                      <div className="h-display" style={{ fontSize: 20, lineHeight: 1.1 }}>{t.l}</div>
                      <div className="h-hand" style={{ fontSize: 12, color: INK_3 }}>{t.s}</div>
                    </div>
                  </div>
                </SketchBox>
              </button>
            ))}
          </div>

          <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 8 }}>HOW DID IT FEEL OVERALL?</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            {[
              { id: 'great', face: '◠‿◠', l: 'Great' },
              { id: 'good', face: '◡◡', l: 'Good' },
              { id: 'okay', face: '◔ ◔', l: 'Okay' },
              { id: 'rough', face: '◠︿◠', l: 'Rough' },
              { id: 'bad', face: '✕✕', l: 'Bad' },
            ].map(f => {
              const active = data.overall_feel === f.id;
              return (
                <button key={f.id} onClick={() => set({ overall_feel: f.id })} style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <SketchBox seed={f.id.length + 80} padding="10px 4px" fill={active ? INK : 'rgba(255,250,235,0.4)'}>
                    <div style={{ textAlign: 'center', color: active ? '#f3ecdb' : INK }}>
                      <div className="h-display" style={{ fontSize: 22, lineHeight: 1 }}>{f.face}</div>
                      <div className="h-hand" style={{ fontSize: 11, marginTop: 4 }}>{f.l}</div>
                    </div>
                  </SketchBox>
                </button>
              );
            })}
          </div>

          <BottomNext onNext={() => setStep(1)} disabled={!data.overall_feel} />
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="screen paper">
        <ScreenHeader onBack={() => setStep(0)} title="Where it hurt" sub="0 = none · 10 = worst" />
        <div className="screen-scroll" style={{ paddingTop: 0 }}>
          <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 16, lineHeight: 1.4 }}>
            Skip a joint if there was no pain there at all.
          </div>
          {[
            { id: 'knee_flexion', l: 'Knee' },
            { id: 'hip_flexion', l: 'Hip' },
            { id: 'ankle_dorsiflexion', l: 'Ankle' },
            { id: 'lumbar_flexion', l: 'Lumbar' },
          ].map((j, i) => (
            <PainSlider key={j.id} label={j.l} value={data.pain[j.id] || 0} onChange={v => setPain(j.id, v)} seed={400+i*7} />
          ))}
          <BottomNext onNext={() => setStep(2)} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen paper">
      <ScreenHeader onBack={() => setStep(1)} title="Notes" sub="anything to flag for Dr. Adler?" />
      <div className="screen-scroll" style={{ paddingTop: 0 }}>
        <Field label="Today's plan (from clinician)">
          <SketchInput as="textarea" rows={3} placeholder="e.g. 3×10 step-ups, 2×30s side plank, no impact" value={data.pt_plan} onChange={v => set({ pt_plan: v })} />
        </Field>
        <Field label="How you felt">
          <SketchInput as="textarea" rows={4} placeholder="Knee gave a bit on the third set of step-ups. Otherwise fine." value={data.notes} onChange={v => set({ notes: v })} />
        </Field>
        <SketchBox seed={500} padding="14px 16px" fill="rgba(255,250,235,0.5)">
          <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 8 }}>SUMMARY</div>
          <div className="h-hand" style={{ fontSize: 14, color: INK_2, lineHeight: 1.5 }}>
            {data.session_type === 'treatment' ? 'Treatment' : data.session_type === 'assessment' ? 'Assessment' : 'Home check'} · feeling <b>{data.overall_feel || '—'}</b> · pain peak <b>{Math.max(...Object.values(data.pain))}/10</b>
          </div>
        </SketchBox>

        <button className="btn-ink" style={{ width: '100%', marginTop: 22 }} onClick={onDone}>Save & sync ✓</button>
        <div style={{ textAlign: 'center', marginTop: 8 }} className="h-hand">
          <span style={{ fontSize: 12, color: INK_FAINT }}>your therapist sees this within the hour</span>
        </div>
      </div>
    </div>
  );
}

function PainSlider({ label, value, onChange, seed }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="h-display" style={{ fontSize: 22 }}>{label}</span>
        <span className="h-display" style={{ fontSize: 28, color: value > 6 ? 'oklch(0.58 0.18 25)' : value > 3 ? 'oklch(0.74 0.14 75)' : INK }}>{value}<span style={{ fontSize: 14, color: INK_3 }}>/10</span></span>
      </div>
      <SketchBox seed={seed} padding="10px 12px" fill="rgba(255,250,235,0.4)">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
          {Array.from({ length: 11 }).map((_, i) => {
            const active = i === value;
            const filled = i <= value;
            return (
              <button key={i} onClick={() => onChange(i)} style={{ flex: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 16, height: 22,
                    background: filled ? (i > 6 ? 'oklch(0.58 0.18 25)' : i > 3 ? 'oklch(0.74 0.14 75)' : INK) : 'transparent',
                    border: `1.4px solid ${INK}`,
                    borderRadius: 3,
                    transform: active ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.1s',
                  }} />
                  <span className="h-hand" style={{ fontSize: 10, color: INK_FAINT }}>{i}</span>
                </div>
              </button>
            );
          })}
        </div>
      </SketchBox>
    </div>
  );
}

// ── PROFILE ─────────────────────────────────────────────────
function ScreenProfile({ profile, onBack, onEdit }) {
  return (
    <div className="screen paper">
      <ScreenHeader onBack={onBack} title="Your record" sub="patient profile" />
      <div className="screen-scroll" style={{ paddingTop: 0 }}>
        <SketchBox seed={600} padding="16px 18px" fill="rgba(255,250,235,0.5)" double>
          <div style={{ display: 'flex', gap: 14 }}>
            <SketchCircle size={64} seed={601} fill="rgba(28,38,50,0.06)">
              <span className="h-display" style={{ fontSize: 30 }}>{(profile.name || 'M').slice(0,1).toUpperCase()}</span>
            </SketchCircle>
            <div style={{ flex: 1 }}>
              <div className="h-display" style={{ fontSize: 28, lineHeight: 1 }}>{profile.name || 'Maya'}</div>
              <div className="h-hand" style={{ fontSize: 13, color: INK_3 }}>id · {profile.patientId || 'p_8a4f'}</div>
              <div style={{ marginTop: 6 }}>
                <span className="tag-pill accent">{(profile.rehab_phase || 'sub-acute').replace('-', ' ')}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 }}>
            <Stat label="age" value={profile.age || 28} />
            <Stat label="bmi" value={profile.bmi || 22.4} />
            <Stat label="ht/wt" value={`${profile.heightCm || 168}·${profile.weightKg || 63}`} small />
          </div>
        </SketchBox>

        <SectionLabel>DIAGNOSIS</SectionLabel>
        <SketchBox seed={610} padding="12px 14px" fill="rgba(255,250,235,0.4)">
          <div className="h-hand" style={{ fontSize: 16, color: INK }}>{profile.diagnosis || 'ACL reconstruction (left)'}</div>
          <div className="h-hand" style={{ fontSize: 12, color: INK_3, marginTop: 4 }}>injured side · <b>{profile.injured_side || 'left'}</b></div>
        </SketchBox>

        <SectionLabel>JOINTS TRACKED</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(profile.injured_joints || ['knee_flexion','hip_flexion']).map(j => (
            <span key={j} className="tag-pill">{prettyJoint(j)}</span>
          ))}
        </div>

        <SectionLabel>CONTRAINDICATIONS</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(profile.contraindications || ['Deep squat below 90°', 'Single-leg hop']).map(c => (
            <span key={c} className="tag-pill" style={{ borderColor: 'oklch(0.58 0.18 25)', color: 'oklch(0.48 0.18 25)' }}>⚠ {c}</span>
          ))}
        </div>

        <SectionLabel>RESTRICTIONS</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(profile.restrictions || ['Knee flexion < 90°', 'Pain ≤ 3/10']).map(c => (
            <span key={c} className="tag-pill">{c}</span>
          ))}
        </div>

        <SectionLabel>CLINICIAN</SectionLabel>
        <SketchBox seed={620} padding="12px 14px" fill="rgba(255,250,235,0.4)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SketchCircle size={36} seed={621} fill="rgba(28,38,50,0.06)"><span className="h-display" style={{ fontSize: 16 }}>A</span></SketchCircle>
            <div style={{ flex: 1 }}>
              <div className="h-hand" style={{ fontSize: 15 }}>{profile.doctorName || 'Dr. M. Adler'}</div>
              <div className="h-hand" style={{ fontSize: 12, color: INK_3 }}>{profile.doctorEmail || 'm.adler@bch.org'}</div>
            </div>
          </div>
        </SketchBox>

        <button onClick={onEdit} className="btn-ink" style={{ width: '100%', marginTop: 22, background: 'transparent', color: INK, border: `1.6px solid ${INK}` }}>
          Update record
        </button>
        <div style={{ textAlign: 'center', marginTop: 14, paddingBottom: 8 }} className="h-hand">
          <span style={{ fontSize: 12, color: INK_FAINT }}>last synced 2 min ago</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, small }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="h-display" style={{ fontSize: small ? 18 : 24, lineHeight: 1.1 }}>{value}</div>
      <div className="h-hand" style={{ fontSize: 11, color: INK_3, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div className="h-hand" style={{ fontSize: 12, color: INK_3, letterSpacing: 1.5, margin: '20px 0 8px' }}>{children}</div>;
}

function ScreenHeader({ onBack, title, sub }) {
  return (
    <div style={{ paddingTop: 60, padding: '60px 22px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M16 4 Q 7 11, 4 12 Q 7 13, 16 20" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>
      <div className="h-display" style={{ fontSize: 36, lineHeight: 1.05, transform: 'rotate(-0.6deg)' }}>{title}</div>
      <Squiggle width={120} />
      {sub && <div className="h-hand" style={{ fontSize: 13, color: INK_3, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

Object.assign(window, {
  ScreenHome, ScreenSession, ScreenMovements, ScreenDoctorReview, ScreenReturn, ScreenProfile,
  ScreenHeader, SectionLabel,
});
