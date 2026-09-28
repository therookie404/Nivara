import React, { useState } from 'react';

// HelpTip.jsx — tiny UI helpers shared across NIVARA's forms and cards.
// Renders a "?" bubble that explains a field on hover/click, plus Field, a
// labeled wrapper that bundles label + HelpTip + input + hint. Used on the
// money manager, alert rules, and onboarding so every field says what the
// model expects and why it needs it.
// Default HelpTip: the "?" badge. Opens on hover for desktop, click for touch.
// Props: text — the explanation string shown inside the floating bubble.
export default function HelpTip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="help-btn"
        onClick={() => setOpen(!open)}
        aria-label="What should I enter?"
      >
        ?
      </button>
      {open && <span className="help-tip">{text}</span>}
    </span>
  );
}

// Reusable labeled field with built-in guidance.
// Props: label (text), help (optional HelpTip body), children (the input), hint (optional small note below).
export function Field({ label, help, children, hint }) {
  return (
    <div className="field">
      <label>
        {label} {help && <HelpTip text={help} />}
      </label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
