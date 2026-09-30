/** Local SVG still so seeded CCTV evidence can be boxed on Verify without binary files. */
export const PLACEHOLDER_CCTV_STILL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
      <rect fill="#0f172a" width="800" height="450"/>
      <rect fill="#1e293b" x="36" y="48" width="728" height="366" rx="10"/>
      <rect fill="#334155" x="72" y="210" width="210" height="170"/>
      <rect fill="#475569" x="420" y="240" width="280" height="140"/>
      <circle fill="#f59e0b" cx="560" cy="168" r="34"/>
      <text fill="#94a3b8" x="400" y="32" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="15">PIER 9 CAM 02 · 02:14</text>
      <text fill="#64748b" x="400" y="430" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="12">Seed still — drag to highlight a region</text>
    </svg>`,
  );
