import React from 'react';
import logoLockupSvg from '../assets/nivara-logo.svg?raw';

// Logo.jsx — NIVARA's brand artwork components (no logic, pure visuals).
// Exports: LogoMark (shield + upward arrow SVG with a draw-in animation),
// LogoLockup (full shield + NIVA₹A wordmark from the SVG asset), and Logo
// (mark + optional wordmark text lockup used in nav, footers, and the hero).
// Animations respect prefers-reduced-motion.
/* NIVARA brand artwork: shield + upward arrow, navy #0f3675 / blue #2176e8.
   The draw-in animation replays once each time the mark mounts. */

const MARK_ANIM_CSS = `
.nl-shield-draw { stroke-dasharray: 450; stroke-dashoffset: 450; animation: nlDrawShield 1.1s cubic-bezier(0.4,0,0.2,1) forwards; }
.nl-arrow-draw { stroke-dasharray: 350; stroke-dashoffset: 350; animation: nlDrawArrow 0.9s cubic-bezier(0.4,0,0.2,1) 0.6s forwards; }
.nl-head-pop { opacity: 0; transform: scale(0.6); transform-box: fill-box; transform-origin: center; animation: nlPopHead 0.4s cubic-bezier(0.34,1.35,0.64,1) 1.2s forwards; }
@keyframes nlDrawShield { to { stroke-dashoffset: 0; } }
@keyframes nlDrawArrow { to { stroke-dashoffset: 0; } }
@keyframes nlPopHead { to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .nl-shield-draw, .nl-arrow-draw { animation: none; stroke-dashoffset: 0; }
  .nl-head-pop { animation: none; opacity: 1; transform: none; }
}
`;

// LogoMark — the shield + upward-arrow SVG mark. Props: size (px), animate
// (plays the stroke draw-in + arrowhead pop on mount; disable for static use).
export function LogoMark({ size = 34, animate = true }) {
  return (
    <svg width={size} height={size} viewBox="125 45 250 255" fill="none" aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}>
      {animate && <style>{MARK_ANIM_CSS}</style>}
      {/* outer shield */}
      <path className={animate ? 'nl-shield-draw' : undefined}
        d="M 250,55 C 278,92 314,105 352,108 C 356,182 322,238 250,285 C 178,238 144,182 148,108 C 186,105 222,92 250,55 Z"
        fill="#0f3675" fillRule="evenodd" />
      {/* inner shield ridge */}
      <path d="M 250,80 C 272,110 300,121 330,123 C 333,180 305,223 250,262 C 195,223 167,180 170,123 C 200,121 228,110 250,80 Z"
        fill="none" stroke="#0f3675" strokeWidth="16" strokeLinejoin="round" />
      {/* upward trend arrow */}
      <polyline className={animate ? 'nl-arrow-draw' : undefined}
        points="140,240 200,165 245,200 309.4,105.2"
        stroke="#2176e8" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* arrowhead */}
      <polygon className={animate ? 'nl-head-pop' : undefined}
        points="332.9,70.4 329.8,114.2 293.4,89.5"
        fill="#2176e8" stroke="#2176e8" strokeWidth="8" strokeLinejoin="round" />
    </svg>
  );
}

/* Full lockup (shield + NIVA₹A wordmark) with the brand's own draw animation. */
// LogoLockup — full brand lockup rendered from the SVG asset.
// animate=false injects CSS that freezes the asset's own animation in its final state
// (used when a static lockup is needed, e.g. repeated renders).
export function LogoLockup({ width = 132, animate = true }) {
  const svg = animate
    ? logoLockupSvg
    : logoLockupSvg.replace(
        '</defs>',
        `<style>
          .anim-shield,.anim-arrow,.anim-arrowhead{animation:none !important;stroke-dashoffset:0 !important;}
          .anim-text{animation:none !important;opacity:1 !important;transform:none !important;}
          @media (prefers-reduced-motion: reduce){
            .anim-shield,.anim-arrow,.anim-arrowhead,.anim-text{animation:none !important;}
          }
        </style></defs>`,
      );
  return (
    <div
      aria-label="NIVARA"
      role="img"
      style={{ width, maxWidth: '100%' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Logo — mark + optional "NIVA₹A" wordmark lockup (₹ styled as brand-rupee).
// Props: size (px), text (show the wordmark), animate (pass through to the mark).
export function Logo({ size = 34, text = true, animate = true }) {
  return (
    <span className="brand-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <LogoMark size={size} animate={animate} />
      {text && (
        <span className="brand-word" style={{ color: '#0f3675' }}>
          NIVA<span className="brand-rupee">₹</span>A
        </span>
      )}
    </span>
  );
}
