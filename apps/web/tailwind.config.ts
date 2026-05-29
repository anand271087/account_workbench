import type { Config } from "tailwindcss";

// Beroe brand tokens — lifted from prototype `:root` block
const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"DM Mono"', "monospace"],
      },
      colors: {
        // Beroe brand palette — anchored to the brand book (Sept 2025).
        // Source of truth: docs/BRAND-AUDIT-2026-05-29.md.
        // All token names below resolve to brand-book hex; the old
        // prototype hex (#40CC8F, #EF9637, #FD576B, #001e52, #001a45,
        // #002050) have been replaced so every `bg-beroe-*` /
        // `text-beroe-*` / `border-beroe-*` utility downstream
        // auto-corrects to brand.
        beroe: {
          // Neutrals
          bg: "#EAF1F5",              // brand Soft Gray (page 35)
          card: "#ffffff",
          "card-border": "#e4eaf6",
          // Primary palette (page 35)
          navy: "#001137",            // Midnight
          "navy-2": "#001137",        // alias → Midnight (was #001a45)
          "navy-3": "#001a45",        // softer Midnight for sidebar hover (kept as a Midnight tint)
          "navy-4": "#001137",        // alias → Midnight (was #001e52)
          blue: "#4A00F8",            // Indigo
          teal: "#35E1D4",            // Aqua
          purple: "#C344C7",          // Fuscia
          yellow: "#FFE61E",          // Bumblebee
          // Risk RAG (page 37) — only colours permitted for status states.
          // Note: token names kept compatible with existing consumers.
          green: "#6EC457",           // Risk Green (was #40CC8F)
          amber: "#F0BC41",           // Risk Amber (was #EF9637)
          red: "#CF4548",             // Risk Red   (was #FD576B)
          coral: "#F0BC41",           // alias → Risk Amber (was duplicate of #EF9637)
        },
        text: {
          primary: "#001137",         // Midnight
          secondary: "#475569",
          muted: "#94a3b8",
          subtle: "#cbd5e1",
        },
        // shadcn/ui semantic tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "14px",      // --rr2 prototype: rounded card
        ctl: "10px",       // --rr  prototype: control radius
      },
      boxShadow: {
        // .sub-tab.active glow from prototype
        subtab: "0 1px 4px rgba(0,0,0,.08)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
