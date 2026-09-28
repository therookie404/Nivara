import React, { useState } from 'react';

// Hover the financial-health gauge to get a plain-words breakdown
// of the score: what it means, how it was made, and the thresholds.
// Wraps the gauge as children and shows a tooltip on hover; the tooltip
// compares the raw model score to the smoothed belief and highlights which
// of the three bands (STABLE <40%, DRIFTING 40–70%, CRITICAL ≥70%) applies.
// Props: assessment ({ status, belief, risk_score, confidence }), children (the gauge to hover).
export default function ScoreExplainer({ assessment, children }) {
  const [open, setOpen] = useState(false);
  const a = assessment;
  // Map the status string to the 0/1/2 band index used for the threshold chips below.
  const band = a.status === 'STABLE' ? 0 : a.status === 'DRIFTING' ? 1 : 2;
  const bandColors = ['#3ddc84', '#ffb020', '#ff5d5d'];   // green / amber / red, matching the gauge

  return (
    <span
      className="score-hover"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <div className="score-tip">
          <h4>📊 What this score means</h4>
          <div>
            <b>Stress belief {Math.round(a.belief * 100)}%</b> — the AI's estimate
            that you'll face a cash shortfall in the coming months.
          </div>
          <div style={{ marginTop: 8 }}>
            <b>How it's made:</b> raw model score {Math.round(a.risk_score * 100)}%
            → smoothed with your history → {Math.round(a.belief * 100)}%.
            Smoothing stops one odd month from flipping the verdict.
          </div>
          <div className="thr">
            {['<40% stable', '40–70% drifting', '≥70% critical'].map((t, i) => (
              <span key={t} className={i === band ? 'on' : ''}
                style={i === band ? { background: bandColors[i] } : {}}>
                {t}
              </span>
            ))}
          </div>
          <div>
            You're in the <b>{a.status}</b> band. Confidence {Math.round(a.confidence * 100)}%
            — more months of data raises it.
          </div>
        </div>
      )}
    </span>
  );
}
