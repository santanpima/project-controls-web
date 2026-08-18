/** @type {import('tailwindcss').Config} */
// Design tokens per 4.2.1.1.1 — these govern app chrome and layout only.
// They deliberately don't reach into AG Grid or Bryntum's own theming (that
// boundary is set explicitly in ADR-002, to avoid two design systems
// fighting each other). Spacing uses Tailwind's default 4px-based scale
// as-is, per that item's own note that nothing identified a need for a
// custom one.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "brand-primary": "#1F3864",
        "brand-accent": "#438DD5",
        "status-success": "#2E7D32",
        "status-warning": "#B36B00",
        "status-error": "#B33A3A",
        "status-info": "#3C8DBC",
        // neutral-50 through neutral-900 (4.2.1.1.1's 9-step gray scale) are
        // NOT extended here — Tailwind's own stock "neutral" palette already
        // provides exactly that range out of the box, the same
        // reuse-over-reinvention pattern already applied to spacing and
        // breakpoints elsewhere in this file.
      },
      fontSize: {
        xs: "12px",
        sm: "14px",
        base: "16px",
        lg: "20px",
        xl: "24px",
        "2xl": "32px",
      },
      boxShadow: {
        "elevation-0": "none",
        "elevation-1": "0 1px 2px 0 rgba(0, 0, 0, 0.08)",
        "elevation-2": "0 4px 8px 0 rgba(0, 0, 0, 0.12)",
        "elevation-3": "0 8px 16px 0 rgba(0, 0, 0, 0.16)",
      },
      // Breakpoints per 4.4.1.1.1 (Mobile 0-767, Tablet 768-1279, Desktop
      // 1280+) — deliberately NOT overridden here. Tailwind's own stock "md"
      // (768px) and "xl" (1280px) already land exactly on those values, and
      // the specification itself calls for reusing Tailwind's existing
      // scale rather than inventing new pixel numbers. The shell components
      // use the md:/xl: prefixes directly for this reason.
    },
  },
  plugins: [],
};
