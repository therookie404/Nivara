import React from 'react';

// Auto-generated "how to read this chart" notes for layman users.
// Props: title — the heading (defaults to 'How to read this chart');
// notes — array of plain-language bullet strings supplied by the chart caller.
export default function ChartNotes({ title = 'How to read this chart', notes }) {
  return (
    <div className="note">
      <b>📊 {title}</b>
      <ul>
        {/* key={i} is fine: notes are static strings in a fixed order, never reordered. */}
        {notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </div>
  );
}
