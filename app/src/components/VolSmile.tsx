"use client";

import { impliedVol, sviTotalVariance } from "../lib/svi";
import type { MarketSnapshot } from "../lib/market";

/** Renders the live SVI smile (annualized IV vs strike moneyness) as an SVG. */
export function VolSmile({ snap }: { snap: MarketSnapshot }) {
  const W = 540;
  const H = 230;
  const pad = 30;
  const kMin = -0.14;
  const kMax = 0.14;
  const N = 64;

  const pts: { k: number; iv: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const k = kMin + (kMax - kMin) * (i / N);
    const iv = impliedVol(Math.max(sviTotalVariance(snap.svi, k), 1e-12), snap.tenorYears);
    pts.push({ k, iv });
  }
  const ivs = pts.map((p) => p.iv);
  const ivMin = Math.min(...ivs) * 0.95;
  const ivMax = Math.max(...ivs) * 1.05;

  const x = (k: number) => pad + ((k - kMin) / (kMax - kMin)) * (W - 2 * pad);
  const y = (iv: number) => pad + (1 - (iv - ivMin) / (ivMax - ivMin)) * (H - 2 * pad);

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.k).toFixed(1)},${y(p.iv).toFixed(1)}`).join(" ");
  const area = `${line} L${x(kMax).toFixed(1)},${H - pad} L${x(kMin).toFixed(1)},${H - pad} Z`;
  const atmIv = impliedVol(Math.max(sviTotalVariance(snap.svi, 0), 1e-12), snap.tenorYears);

  const ticks = [-0.1, -0.05, 0, 0.05, 0.1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Live volatility smile">
      <defs>
        <linearGradient id="smileFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38d6ff" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#38d6ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="smileLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#28e0a0" />
          <stop offset="50%" stopColor="#38d6ff" />
          <stop offset="100%" stopColor="#7b8cff" />
        </linearGradient>
      </defs>

      {ticks.map((k) => (
        <g key={k}>
          <line x1={x(k)} y1={pad} x2={x(k)} y2={H - pad} stroke="rgba(255,255,255,0.05)" />
          <text x={x(k)} y={H - 10} fill="#545d6e" fontSize="10" textAnchor="middle" fontFamily="monospace">
            {k === 0 ? "ATM" : `${k > 0 ? "+" : ""}${(k * 100).toFixed(0)}%`}
          </text>
        </g>
      ))}

      <path d={area} fill="url(#smileFill)" />
      <path d={line} fill="none" stroke="url(#smileLine)" strokeWidth="2.5" strokeLinecap="round" />

      {/* ATM marker */}
      <line x1={x(0)} y1={pad} x2={x(0)} y2={H - pad} stroke="rgba(56,214,255,0.45)" strokeDasharray="3 3" />
      <circle cx={x(0)} cy={y(atmIv)} r="4" fill="#38d6ff" />
      <text x={x(0) + 8} y={y(atmIv) - 8} fill="#e8edf6" fontSize="11" fontFamily="monospace">
        {(atmIv * 100).toFixed(0)}% IV
      </text>

      <text x={pad} y={18} fill="#8a94a6" fontSize="10.5" fontFamily="monospace">
        annualized IV
      </text>
    </svg>
  );
}
