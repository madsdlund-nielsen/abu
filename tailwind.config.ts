import type { Config } from "tailwindcss";

/**
 * Tailwind-temaet er kun et spejl af design-tokens (src/styles/design-tokens.css).
 * Standardpaletten, radius og skygger er fjernet med vilje: border-radius er 0 overalt, og skygger findes kun som `shadow-panel`.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      white: "var(--color-white)",
      navy: "var(--color-navy)",
      charcoal: "var(--color-charcoal)",
      gold: "var(--color-gold)",
      "gold-dark": "var(--color-gold-dark)",
      "gold-ink": "var(--color-gold-ink)",
      "on-gold": "var(--color-on-gold)",
      eyebrow: "var(--color-eyebrow)",
      "eyebrow-on-dark": "var(--color-eyebrow-on-dark)",
      placeholder: "var(--color-placeholder)",
      "topbar-navy": "var(--color-topbar-navy)",
      ink: "var(--color-text)",
      muted: "var(--color-text-muted)",
      "grey-bg": "var(--color-grey-bg)",
      slate: "var(--color-slate)",
      link: "var(--color-link)",
      danger: "var(--color-danger)",
      "on-dark-soft": "var(--text-on-dark-soft)",
      "divider-light": "var(--divider-light)",
      "overlay-navy": "var(--overlay-navy)",
      "tint-steel": "var(--tint-steel)",
    },
    borderRadius: { none: "0", DEFAULT: "0", sm: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0", full: "0" },
    boxShadow: { none: "none", panel: "var(--shadow-panel)" },
    extend: {
      fontFamily: { sans: ["var(--font-sans)"] },
      spacing: {
        "space-1": "var(--space-1)",
        "space-2": "var(--space-2)",
        "space-3": "var(--space-3)",
        "space-4": "var(--space-4)",
        "space-5": "var(--space-5)",
        "space-6": "var(--space-6)",
        section: "var(--space-section)",
      },
      maxWidth: { container: "var(--container-max)" },
      letterSpacing: { wide: "var(--letter-spacing-ui)", eyebrow: "0.4em" },
      fontWeight: { light: "300", normal: "400", semibold: "600", bold: "700" },
    },
  },
  plugins: [],
};
export default config;
