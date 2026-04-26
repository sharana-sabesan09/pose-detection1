// onboarding.jsx — All onboarding/intake screens for Sentinel
// Pages: welcome, demographics (existing), injured joints, injured side,
// rehab phase, diagnosis, contraindications, restrictions, doctor link, done

const REHAB_PHASES = [
{ id: 'acute', label: 'Acute', sub: '0–2 weeks · pain & swelling' },
{ id: 'sub-acute', label: 'Sub-acute', sub: '2–6 weeks · range of motion' },
{ id: 'functional', label: 'Functional', sub: '6–12 weeks · strength' },
{ id: 'return-to-sport', label: 'Return to sport', sub: '12 weeks+ · sport-specific' }];


const JOINT_OPTIONS = [
'hip_flexion', 'hip_extension', 'hip_abduction',
'knee_flexion', 'ankle_dorsiflexion', 'ankle_plantarflexion',
'shoulder_flexion', 'shoulder_abduction', 'lumbar_flexion'];


const COMMON_CONTRAS = [
'Deep squat below 90°', 'Full weight-bearing', 'End-range hip IR',
'Overhead loading', 'Knee valgus', 'Spinal flexion w/ load', 'Single-leg hop'];


const COMMON_RESTRICTS = [
'Max 50% body weight', 'Knee flexion < 90°', 'No running', 'Pain ≤ 3/10',
'Avoid impact', 'Tempo 3-1-3', 'Brace on for ADLs'];


const DIAGNOSIS_SUGGEST = [
'ACL reconstruction', 'Patellofemoral pain', 'Grade II ankle sprain',
'Rotator cuff repair', 'Achilles tendinopathy', 'Meniscus tear', 'Hip labral repair'];


// ── 1. WELCOME ───────────────────────────────────────────────
function ScreenWelcome({ onNext }) {
  return (
    <div className="screen paper">
      <div className="screen-scroll" style={{ paddingTop: 70 }}>
        <div style={{ textAlign: 'center', paddingTop: 30 }}>
          <div className="h-display" style={{ fontSize: 56, color: INK, lineHeight: 1, transform: 'rotate(-2deg)' }}>Sentinel</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}><Squiggle width={140} /></div>
          <div className="h-hand" style={{ marginTop: 18, fontSize: 18, color: INK_2, lineHeight: 1.45, padding: '0 18px' }}>
            a quiet companion for the<br />days between visits.
          </div>
        </div>

        <div style={{ marginTop: 36, position: 'relative' }}>
          {/* sketch illustration of a person walking with annotations */}
          <svg viewBox="0 0 280 200" style={{ width: '100%' }}>
            {/* ground */}
            <path d="M 10 175 Q 140 178, 270 175" stroke={INK} strokeWidth="1.4" fill="none" />
            {/* figure */}
            <circle cx="120" cy="55" r="14" stroke={INK} strokeWidth="1.6" fill="rgba(255,250,235,0.6)" />
            <path d="M 120 70 L 120 130" stroke={INK} strokeWidth="1.6" />
            <path d="M 120 88 Q 105 100, 95 118" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M 120 88 Q 138 95, 150 110" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M 120 130 Q 110 150, 102 175" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M 120 130 Q 132 152, 142 175" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            {/* dashed sight lines (camera) */}
            <path d="M 30 30 L 105 60" stroke={INK} strokeWidth="1" strokeDasharray="3 4" fill="none" />
            <path d="M 30 30 L 100 90" stroke={INK} strokeWidth="1" strokeDasharray="3 4" fill="none" />
            {/* camera */}
            <rect x="14" y="18" width="22" height="16" rx="2" stroke={INK} strokeWidth="1.4" fill="rgba(255,250,235,0.6)" />
            <circle cx="25" cy="26" r="4" stroke={INK} strokeWidth="1.4" fill="none" />
            {/* annotations */}
            <text x="190" y="65" fontFamily="Caveat" fontSize="18" fill={INK} transform="rotate(-4 190 65)">tracks how you move</text>
            <path d="M 188 70 Q 175 80, 158 95" stroke={INK} strokeWidth="1.2" fill="none" />
            <path d="M 158 95 L 162 88 M 158 95 L 165 96" stroke={INK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <text x="185" y="155" fontFamily="Caveat" fontSize="18" fill={INK} transform="rotate(-2 185 155)">flags re-injury risk</text>
            <path d="M 218 158 Q 230 170, 248 168" stroke={INK} strokeWidth="1.2" fill="none" />
          </svg>
        </div>

        <div style={{ marginTop: 30 }}>
          <SketchBox seed={11} padding="14px 16px" fill="rgba(255,250,235,0.5)">
            <div className="h-hand" style={{ fontSize: 14, color: INK_2 }}>
              A few questions to set up your record.<br />
              Most are <span className="scribble-under">optional</span> — your therapist can fill in the rest.
            </div>
          </SketchBox>
        </div>

        <button className="btn-ink" style={{ width: '100%', marginTop: 24 }} onClick={onNext}>
          Let's begin →
        </button>
        <div style={{ textAlign: 'center', marginTop: 12 }} className="h-hand">
          <span style={{ fontSize: 13, color: INK_3 }}>takes about 3 minutes</span>
        </div>
      </div>
    </div>);

}
const INK_2 = '#354352',INK_3 = '#5b6878';

// ── 2. DEMOGRAPHICS (kept similar, restyled) ────────────────
function ScreenDemographics({ data, set, onNext, onBack }) {
  const bmi = data.heightCm && data.weightKg ?
  (parseFloat(data.weightKg) / Math.pow(parseFloat(data.heightCm) / 100, 2)).toFixed(1) :
  null;
  const valid = data.age && data.heightCm && data.weightKg && data.gender;
  return (
    <OnbShell step={1} total={7} onBack={onBack} title="About you">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 18 }}>
        Used to set a baseline. Stays on this device + your patient record.
      </div>

      <Field label="Age">
        <SketchInput type="number" placeholder="68" value={data.age} onChange={(v) => set({ age: v })} suffix="years" />
      </Field>

      <Field label="Biological sex">
        <div style={{ display: 'flex', gap: 8 }}>
          {['male', 'female', 'other'].map((g) =>
          <PillToggle key={g} active={data.gender === g} onClick={() => set({ gender: g })}>
              {g[0].toUpperCase() + g.slice(1)}
            </PillToggle>
          )}
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Height">
          <SketchInput type="number" placeholder="165" value={data.heightCm} onChange={(v) => set({ heightCm: v })} suffix="cm" />
        </Field>
        <Field label="Weight">
          <SketchInput type="number" placeholder="72" value={data.weightKg} onChange={(v) => set({ weightKg: v })} suffix="kg" />
        </Field>
      </div>

      {bmi &&
      <div style={{ marginTop: 6, marginBottom: 8 }}>
          <SketchBox seed={22} padding="10px 14px" fill="rgba(255,250,235,0.55)">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1 }}>BMI</span>
              <span className="h-display" style={{ fontSize: 26 }}>{bmi}</span>
            </div>
          </SketchBox>
        </div>
      }

      <BottomNext disabled={!valid} onNext={onNext} />
    </OnbShell>);

}

// ── 2b. PT RECORDS (optional file/notes upload) ──────────────
function ScreenPTRecords({ data, set, onNext, onBack, onSkip }) {
  const records = data.pt_records || [];
  const addRecord = () => {
    const fake = {
      id: 'r_' + Date.now(),
      name: 'Record ' + (records.length + 1) + '.pdf',
      pages: Math.floor(Math.random() * 8) + 2,
      added: 'just now'
    };
    set({ pt_records: [...records, fake] });
  };
  const removeRecord = (id) => {
    set({ pt_records: records.filter((r) => r.id !== id) });
  };
  const setNote = (note) => set({ pt_records_note: note });
  return (
    <OnbShell step={2} total={7} onBack={onBack} title="Past PT records">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 14, lineHeight: 1.45 }}>
        Drop in any prior PT notes, scans, or summaries. We'll use them to seed your plan — nothing is shared without your say-so.
      </div>

      {/* drop zone */}
      <button onClick={addRecord} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', fontFamily: 'inherit', textAlign: 'left', color: 'inherit' }}>
        <SketchBox seed={140} padding="22px 18px" fill="rgba(255,250,235,0.5)" double>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <SketchCircle size={50} seed={141} fill="rgba(28,38,50,0.05)">
              <span className="h-display" style={{ fontSize: 30, color: INK, lineHeight: 1 }}>+</span>
            </SketchCircle>
            <div style={{ flex: 1 }}>
              <div className="h-display" style={{ fontSize: 22, lineHeight: 1.05 }}>Append a record</div>
              <div className="h-hand" style={{ fontSize: 13, color: INK_3 }}>PDF · photo · doctor's letter</div>
            </div>
          </div>
        </SketchBox>
      </button>

      {records.length > 0 &&
      <div style={{ marginTop: 14 }}>
          <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 8 }}>APPENDED ({records.length})</div>
          {records.map((r, i) =>
        <div key={r.id} style={{ marginBottom: 8 }}>
              <SketchBox seed={150 + i * 4} padding="10px 12px" fill="rgba(255,250,235,0.45)">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <RecordIcon />
                  <div style={{ flex: 1 }}>
                    <div className="h-hand" style={{ fontSize: 15, color: INK }}>{r.name}</div>
                    <div className="h-hand" style={{ fontSize: 11, color: INK_3 }}>{r.pages} pages · added {r.added}</div>
                  </div>
                  <button onClick={() => removeRecord(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: INK_FAINT, fontFamily: 'inherit' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M5 5 L 19 19 M 19 5 L 5 19" stroke={INK_FAINT} strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </button>
                </div>
              </SketchBox>
            </div>
        )}
        </div>
      }

      <div style={{ marginTop: 18 }}>
        <Field label="Or jot a quick note">
          <SketchInput as="textarea" rows={3} placeholder="e.g. ACL repair Jan 2026 at City Ortho. PT 2x/week since Feb." value={data.pt_records_note || ''} onChange={setNote} />
        </Field>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn-ink" style={{ width: '100%' }} onClick={onNext}>Continue →</button>
        <button onClick={onSkip} style={{ background: 'none', border: 'none', padding: '8px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <span className="h-hand" style={{ fontSize: 14, color: INK_3, textDecoration: 'underline', textUnderlineOffset: 3 }}>Skip — I'll add later</span>
        </button>
      </div>
    </OnbShell>);

}

function RecordIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32">
      <path d="M 7 4 L 22 4 L 27 9 L 27 28 L 7 28 Z" stroke={INK} strokeWidth="1.5" fill="rgba(255,250,235,0.7)" strokeLinejoin="round" />
      <path d="M 22 4 L 22 9 L 27 9" stroke={INK} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      <path d="M 11 14 L 23 14 M 11 18 L 23 18 M 11 22 L 19 22" stroke={INK_3} strokeWidth="1.2" strokeLinecap="round" />
    </svg>);

}

// ── 3. INJURED JOINTS ────────────────────────────────────────
function ScreenInjuredJoints({ data, set, onNext, onBack }) {
  const sel = data.injured_joints || [];
  const toggle = (id) => {
    // strip any _r suffix to map to backend joint names
    const real = id.replace('_r', '');
    const next = sel.includes(real) ? sel.filter((x) => x !== real) : [...sel, real];
    set({ injured_joints: next });
  };
  return (
    <OnbShell step={3} total={7} onBack={onBack} title="Where does it hurt?">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 14 }}>
        Tap the joints involved in your injury.
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <BodyDiagram selected={sel} onToggle={toggle} side={data.injured_side} />
        <div style={{ position: 'absolute', right: 0, top: 30, transform: 'rotate(6deg)' }}>
          <div className="h-display" style={{ fontSize: 17, color: INK_3 }}>tap any joint</div>
          <Squiggle width={70} />
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="h-hand" style={{ fontSize: 13, color: INK_3, marginBottom: 8 }}>SELECTED ({sel.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sel.length === 0 && <span className="h-hand" style={{ fontSize: 14, color: INK_FAINT }}>none yet</span>}
          {sel.map((j) => <span key={j} className="tag-pill accent">{prettyJoint(j)}</span>)}
        </div>
      </div>
      <BottomNext disabled={false} onNext={onNext} hint="optional" />
    </OnbShell>);

}
const INK_FAINT = '#8a93a0';

function prettyJoint(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── 4. INJURED SIDE ──────────────────────────────────────────
function ScreenInjuredSide({ data, set, onNext, onBack }) {
  return (
    <OnbShell step={4} total={7} onBack={onBack} title="Which side?">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 22 }}>
        Helps us read your camera data correctly.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
        { id: 'left', label: 'Left' },
        { id: 'right', label: 'Right' }].
        map((s) =>
        <BigChoice key={s.id} active={data.injured_side === s.id} onClick={() => set({ injured_side: s.id })}>
            <BodyMini side={s.id} />
            <div className="h-display" style={{ fontSize: 26, marginTop: 8 }}>{s.label}</div>
          </BigChoice>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <BigChoice active={data.injured_side === 'bilateral'} onClick={() => set({ injured_side: 'bilateral' })} horizontal>
          <BodyMini side="bilateral" small />
          <div>
            <div className="h-display" style={{ fontSize: 24 }}>Bilateral</div>
            <div className="h-hand" style={{ fontSize: 13, color: INK_3 }}>Both sides affected</div>
          </div>
        </BigChoice>
      </div>
      <BottomNext disabled={!data.injured_side} onNext={onNext} />
    </OnbShell>);

}

function BodyMini({ side, small }) {
  const w = small ? 42 : 70;
  const h = small ? 56 : 96;
  const leftFill = side === 'left' || side === 'bilateral' ? INK : 'transparent';
  const rightFill = side === 'right' || side === 'bilateral' ? INK : 'transparent';
  return (
    <svg viewBox="0 0 60 80" style={{ width: w, height: h }}>
      <circle cx="30" cy="12" r="8" stroke={INK} strokeWidth="1.4" fill="rgba(255,250,235,0.5)" />
      <path d="M 22 22 Q 18 40, 22 58 L 38 58 Q 42 40, 38 22 Z" stroke={INK} strokeWidth="1.4" fill="rgba(255,250,235,0.5)" strokeLinejoin="round" />
      <path d="M 28 58 L 26 76" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 32 58 L 34 76" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      {/* highlights */}
      <ellipse cx="22" cy="40" rx="4" ry="14" fill={leftFill} opacity="0.85" />
      <ellipse cx="38" cy="40" rx="4" ry="14" fill={rightFill} opacity="0.85" />
    </svg>);

}

// ── 5. REHAB PHASE ───────────────────────────────────────────
function ScreenRehabPhase({ data, set, onNext, onBack }) {
  return (
    <OnbShell step={5} total={7} onBack={onBack} title="Where in recovery?">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 16 }}>
        Your therapist may update this over time.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {REHAB_PHASES.map((p, i) => {
          const active = data.rehab_phase === p.id;
          return (
            <button key={p.id} onClick={() => set({ rehab_phase: p.id })} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
              <SketchBox seed={30 + i * 3} padding="12px 14px" fill={active ? 'rgba(28,38,50,0.06)' : 'rgba(255,250,235,0.4)'} double={active}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 30, textAlign: 'center', flexShrink: 0 }}>
                    <div className="h-display" style={{ fontSize: 28, color: active ? INK : INK_FAINT, lineHeight: 1 }}>{i + 1}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="h-display" style={{ fontSize: 24, lineHeight: 1.1 }}>{p.label}</div>
                    <div className="h-hand" style={{ fontSize: 13, color: INK_3 }}>{p.sub}</div>
                  </div>
                  {active && <CheckMark size={20} />}
                </div>
              </SketchBox>
            </button>);

        })}
      </div>
      <BottomNext disabled={!data.rehab_phase} onNext={onNext} />
    </OnbShell>);

}

// ── 6b. CLINICAL TALK (combined diagnosis + avoid + limits) ─
function ScreenClinicalTalk({ data, set, onNext, onBack, onSkip }) {
  const [open, setOpen] = React.useState(null); // 'diagnosis' | 'avoid' | 'limits' | null
  const list = data.contraindications || [];
  const limits = data.restrictions || [];
  const toggle = (key, item) => {
    const arr = data[key] || [];
    const next = arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
    set({ [key]: next });
  };

  return (
    <OnbShell step={6} total={7} onBack={onBack} title="Let's talk about it">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 14, lineHeight: 1.45 }}>
        Tell us what your clinician said — diagnosis, things to avoid, and any limits. All optional.
      </div>

      {/* big primary "talk" CTA */}
      <button onClick={() => setOpen(open === 'all' ? null : 'all')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', fontFamily: 'inherit', textAlign: 'left', color: 'inherit' }}>
        <SketchBox seed={170} padding="18px 20px" fill="oklch(0.92 0.05 35 / 0.6)" stroke="oklch(0.48 0.13 35)" strokeWidth={2} double>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <SketchCircle size={52} seed={171} fill="oklch(0.96 0.03 35 / 0.8)" stroke="oklch(0.48 0.13 35)">
              <TalkIcon />
            </SketchCircle>
            <div style={{ flex: 1 }}>
              <div className="h-display" style={{ fontSize: 26, lineHeight: 1.05, color: 'oklch(0.32 0.1 35)' }}>Talk about it</div>
              <div className="h-hand" style={{ fontSize: 13, color: 'oklch(0.42 0.1 35)' }}>diagnosis · avoid · limits — together</div>
            </div>
            <svg width="22" height="22" viewBox="0 0 24 24" style={{ transform: open === 'all' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.18s' }}>
              <path d="M8 4 Q 17 11, 20 12 Q 17 13, 8 20" stroke="oklch(0.48 0.13 35)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </SketchBox>
      </button>

      {open === 'all' &&
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* diagnosis */}
          <div>
            <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 6 }}>① DIAGNOSIS</div>
            <SketchInput as="textarea" rows={2} placeholder="e.g. ACL reconstruction (left)" value={data.diagnosis || ''} onChange={(v) => set({ diagnosis: v })} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {DIAGNOSIS_SUGGEST.slice(0, 5).map((d) =>
            <button key={d} onClick={() => set({ diagnosis: d })} className="tag-pill" style={{ cursor: 'pointer' }}>{d}</button>
            )}
            </div>
          </div>

          {/* avoid */}
          <div>
            <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 6 }}>② TO AVOID</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COMMON_CONTRAS.map((c) => {
              const on = list.includes(c);
              return (
                <button key={c} onClick={() => toggle('contraindications', c)} className={`tag-pill ${on ? 'active' : ''}`} style={{ cursor: 'pointer', borderColor: on ? 'oklch(0.48 0.18 25)' : undefined, background: on ? 'oklch(0.58 0.18 25)' : undefined, color: on ? '#f3ecdb' : undefined }}>
                    {on ? '⚠ ' : ''}{c}
                  </button>);

            })}
            </div>
          </div>

          {/* limits */}
          <div>
            <div className="h-hand" style={{ fontSize: 13, color: INK_3, letterSpacing: 1, marginBottom: 6 }}>③ LIMITS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COMMON_RESTRICTS.map((c) => {
              const on = limits.includes(c);
              return (
                <button key={c} onClick={() => toggle('restrictions', c)} className={`tag-pill ${on ? 'active' : ''}`} style={{ cursor: 'pointer' }}>
                    {c}
                  </button>);

            })}
            </div>
            <div style={{ marginTop: 8 }}>
              <SketchInput placeholder="Add your own limit…" value={data.restriction_other || ''} onChange={(v) => set({ restriction_other: v })} />
            </div>
          </div>

          {/* tiny summary */}
          <SketchBox seed={195} padding="10px 12px" fill="rgba(255,250,235,0.5)">
            <div className="h-hand" style={{ fontSize: 12, color: INK_3, letterSpacing: 1, marginBottom: 4 }}>SO FAR</div>
            <div className="h-hand" style={{ fontSize: 13, color: INK_2, lineHeight: 1.45 }}>
              {data.diagnosis || <span style={{ color: INK_FAINT }}>no diagnosis yet</span>} · {(data.contraindications || []).length} to avoid · {(data.restrictions || []).length} limits
            </div>
          </SketchBox>
        </div>
      }

      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn-ink" style={{ width: '100%' }} onClick={onNext}>Continue →</button>
        <button onClick={onSkip} style={{ background: 'none', border: 'none', padding: '8px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <span className="h-hand" style={{ fontSize: 14, color: INK_3, textDecoration: 'underline', textUnderlineOffset: 3 }}>Skip — I'll talk about it after onboarding</span>
        </button>
      </div>
    </OnbShell>);

}

function TalkIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32">
      {/* speech bubble */}
      <path d="M 5 8 Q 5 5, 8 5 L 24 5 Q 27 5, 27 8 L 27 19 Q 27 22, 24 22 L 14 22 L 9 27 L 10 22 L 8 22 Q 5 22, 5 19 Z"
      stroke="oklch(0.48 0.13 35)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <circle cx="11" cy="13.5" r="1.4" fill="oklch(0.48 0.13 35)" />
      <circle cx="16" cy="13.5" r="1.4" fill="oklch(0.48 0.13 35)" />
      <circle cx="21" cy="13.5" r="1.4" fill="oklch(0.48 0.13 35)" />
    </svg>);

}

// ── 6. DIAGNOSIS ─────────────────────────────────────────────
function ScreenDiagnosis({ data, set, onNext, onBack }) {
  return (
    <OnbShell step={5} total={8} onBack={onBack} title="What's the diagnosis?">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 16 }}>
        From your clinician's notes — paste or paraphrase.
      </div>
      <Field label="Primary diagnosis">
        <SketchInput as="textarea" placeholder="e.g. ACL reconstruction (left)" value={data.diagnosis} onChange={(v) => set({ diagnosis: v })} rows={3} />
      </Field>
      <div className="h-hand" style={{ fontSize: 13, color: INK_3, marginBottom: 8, marginTop: 4 }}>COMMON</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {DIAGNOSIS_SUGGEST.map((d) =>
        <button key={d} onClick={() => set({ diagnosis: d })} className="tag-pill" style={{ cursor: 'pointer' }}>{d}</button>
        )}
      </div>
      <BottomNext onNext={onNext} hint="optional" />
    </OnbShell>);

}

// ── 7. CONTRAINDICATIONS ─────────────────────────────────────
function ScreenContraindications({ data, set, onNext, onBack }) {
  const list = data.contraindications || [];
  const toggle = (item) => {
    const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
    set({ contraindications: next });
  };
  return (
    <OnbShell step={6} total={8} onBack={onBack} title="Anything to avoid?">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 14 }}>
        Movements your clinician has told you <span className="scribble-under">not</span> to do.
      </div>
      <SketchBox seed={45} padding="12px 14px" fill="oklch(0.95 0.04 25 / 0.6)" stroke="oklch(0.48 0.13 25)">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 22 }}>⚠</div>
          <div className="h-hand" style={{ fontSize: 13, color: INK_2, lineHeight: 1.4 }}>
            We'll warn you if a session plan crosses any of these.
          </div>
        </div>
      </SketchBox>

      <div className="h-hand" style={{ fontSize: 13, color: INK_3, margin: '16px 0 8px', letterSpacing: 1 }}>COMMON</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {COMMON_CONTRAS.map((c) =>
        <SketchCheck key={c} checked={list.includes(c)} onClick={() => toggle(c)} label={c} seed={50 + c.length} />
        )}
      </div>

      <div className="h-hand" style={{ fontSize: 13, color: INK_3, margin: '16px 0 8px', letterSpacing: 1 }}>OTHER</div>
      <Field label={null}>
        <SketchInput placeholder="add another…" value={data.contraindication_other || ''} onChange={(v) => set({ contraindication_other: v })} />
      </Field>

      <BottomNext onNext={onNext} hint="optional" />
    </OnbShell>);

}

// ── 8. RESTRICTIONS ──────────────────────────────────────────
function ScreenRestrictions({ data, set, onNext, onBack }) {
  const list = data.restrictions || [];
  const toggle = (item) => {
    const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
    set({ restrictions: next });
  };
  return (
    <OnbShell step={7} total={8} onBack={onBack} title="Any limits?">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 14 }}>
        Soft limits — load or range-of-motion you can work up to but not past.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {COMMON_RESTRICTS.map((c) =>
        <SketchCheck key={c} checked={list.includes(c)} onClick={() => toggle(c)} label={c} seed={70 + c.length} />
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Add your own">
          <SketchInput placeholder="e.g. Knee flexion < 100°" value={data.restriction_other || ''} onChange={(v) => set({ restriction_other: v })} />
        </Field>
      </div>
      <BottomNext onNext={onNext} hint="optional" />
    </OnbShell>);

}

// ── 9. DOCTOR LINK ───────────────────────────────────────────
function ScreenDoctor({ data, set, onNext, onBack }) {
  return (
    <OnbShell step={7} total={7} onBack={onBack} title="Link your clinician">
      <div className="h-hand" style={{ fontSize: 14, color: INK_2, marginBottom: 16 }}>
        So they see your sessions and can write notes back to you.
      </div>
      <Field label="Clinician code or email">
        <SketchInput placeholder="dr.adler@clinic.org" value={data.doctorEmail} onChange={(v) => set({ doctorEmail: v })} />
      </Field>
      <Field label="Their name (optional)">
        <SketchInput placeholder="Dr. Adler" value={data.doctorName} onChange={(v) => set({ doctorName: v })} />
      </Field>
      <div style={{ marginTop: 14 }}>
        <SketchBox seed={91} padding="14px 16px" fill="rgba(255,250,235,0.55)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SketchCircle size={42} seed={92} fill="rgba(28,38,50,0.06)">
              <span style={{ fontSize: 20 }}>✎</span>
            </SketchCircle>
            <div className="h-hand" style={{ fontSize: 13, color: INK_2, lineHeight: 1.4 }}>
              You can skip this and add a clinician later from your profile.
            </div>
          </div>
        </SketchBox>
      </div>
      <BottomNext onNext={onNext} label="Finish setup →" hint="optional" />
    </OnbShell>);

}

// ─── shared bits ────────────────────────────────────────────
function OnbShell({ step, total, onBack, title, children }) {
  return (
    <div className="screen paper">
      <div style={{ paddingTop: 60, paddingLeft: 22, paddingRight: 22, paddingBottom: 6, display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M16 4 Q 7 11, 4 12 Q 7 13, 16 20" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          {Array.from({ length: total }).map((_, i) =>
          <div key={i} style={{ flex: 1, height: 4, background: i < step ? INK : 'rgba(28,38,50,0.18)', borderRadius: 2 }} />
          )}
        </div>
        <span className="h-hand" style={{ fontSize: 12, color: INK_3 }}>{step}/{total}</span>
      </div>
      <div className="screen-scroll" style={{ paddingTop: 14 }}>
        <div className="h-display" style={{ fontSize: 36, lineHeight: 1.05, marginBottom: 6, transform: 'rotate(-0.7deg)' }}>{title}</div>
        <Squiggle width={140} />
        <div style={{ marginTop: 18 }}>{children}</div>
      </div>
    </div>);

}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div className="h-hand" style={{ fontSize: 13, color: INK_3, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>}
      {children}
    </div>);

}

function SketchInput({ value, onChange, placeholder, type = 'text', suffix, as = 'input', rows = 1 }) {
  const Tag = as === 'textarea' ? 'textarea' : 'input';
  return (
    <SketchBox seed={(placeholder || '').length + 17} padding="0" fill="rgba(255,253,245,0.7)">
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }}>
        <Tag
          type={type}
          rows={as === 'textarea' ? rows : undefined}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            fontFamily: 'Kalam, cursive', fontSize: 17, color: INK,
            padding: '12px 14px', resize: 'none'
          }} />
        
        {suffix && <span className="h-hand" style={{ paddingRight: 14, paddingLeft: 4, color: INK_3, fontSize: 14, flexShrink: 0 }}>{suffix}</span>}
      </div>
    </SketchBox>);

}

function PillToggle({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`tag-pill ${active ? 'active' : ''}`} style={{ flex: 1, justifyContent: 'center', cursor: 'pointer', padding: '10px', fontSize: 15 }}>
      {children}
    </button>);

}

function BigChoice({ active, onClick, children, horizontal }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit', color: 'inherit', width: '100%' }}>
      <SketchBox seed={active ? 88 : 22} padding="20px 14px" fill={active ? 'rgba(28,38,50,0.06)' : 'rgba(255,250,235,0.4)'} double={active}>
        <div style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: horizontal ? 14 : 4 }}>
          {children}
        </div>
      </SketchBox>
    </button>);

}

function BottomNext({ onNext, disabled, label = 'Continue →', hint }) {
  return (
    <div style={{ marginTop: 28, marginBottom: 12 }}>
      <button className="btn-ink" disabled={disabled} style={{ width: '100%', opacity: disabled ? 0.4 : 1 }} onClick={() => !disabled && onNext()}>{label}</button>
      {hint && <div style={{ textAlign: 'center', marginTop: 8 }} className="h-hand"><span style={{ fontSize: 12, color: INK_FAINT }}>{hint}</span></div>}
    </div>);

}

Object.assign(window, {
  ScreenWelcome, ScreenDemographics, ScreenPTRecords, ScreenInjuredJoints, ScreenInjuredSide,
  ScreenRehabPhase, ScreenClinicalTalk, ScreenDiagnosis, ScreenContraindications, ScreenRestrictions, ScreenDoctor,
  OnbShell, Field, SketchInput, PillToggle, BottomNext, BigChoice, prettyJoint,
  REHAB_PHASES, JOINT_OPTIONS, INK_2, INK_3, INK_FAINT
});