import React from 'react';

// SVG arc gauge for the stress belief (0..1).
// Renders a half-dial with three faint background arcs marking the risk bands —
// STABLE below 0.40 (green), DRIFTING 0.40–0.70 (amber), CRITICAL at/above 0.70 (red) —
// plus a colored sweep up to the belief value, a needle, and the % readout.
// Props: belief (number 0..1) — the XGBoost model's smoothed stress belief.
export default function RiskGauge({ belief }) {
  const W = 240, H = 140, CX = 120, CY = 125, R = 95;
  // ang maps a 0..1 value onto a half-circle: 0 -> pointing left, 1 -> pointing right.
  const ang = (v) => Math.PI - v * Math.PI;
  // pt converts a 0..1 value + radius into SVG coordinates on the dial.
  const pt = (v, r = R) => [CX + r * Math.cos(ang(v)), CY - r * Math.sin(ang(v))];
  // arc builds an SVG path for the dial segment between values a and b.
  const arc = (a, b, r = R) => {
    const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  // Needle tip: clamp belief into [0,1] so the needle never leaves the dial.
  const [nx, ny] = pt(Math.min(1, Math.max(0, belief)), R - 18);
  // Needle/sweep color follows the risk band thresholds (green <0.4, amber <0.7, red >=0.7).
  const color = belief >= 0.7 ? '#ff5d5d' : belief >= 0.4 ? '#ffb020' : '#3ddc84';
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <path d={arc(0, 0.4)} stroke="#3ddc84" strokeWidth="16" fill="none" strokeLinecap="round" opacity="0.35" />
      <path d={arc(0.4, 0.7)} stroke="#ffb020" strokeWidth="16" fill="none" opacity="0.35" />
      <path d={arc(0.7, 1)} stroke="#ff5d5d" strokeWidth="16" fill="none" strokeLinecap="round" opacity="0.35" />
      <path d={arc(0, Math.min(1, Math.max(0, belief)))} stroke={color} strokeWidth="16" fill="none" strokeLinecap="round" />
      {/* needle + hub + % readout, colored by the current risk band */}
      <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="#23235e" strokeWidth="3" strokeLinecap="round" />
      <circle cx={CX} cy={CY} r="7" fill="#23235e" />
      <text x={CX} y={CY - 34} textAnchor="middle" fill={color} fontSize="30" fontWeight="800">
        {Math.round(belief * 100)}%
      </text>
      <text x={CX} y={CY - 14} textAnchor="middle" fill="#8a90a6" fontSize="11">stress belief</text>
    </svg>
  );
}
