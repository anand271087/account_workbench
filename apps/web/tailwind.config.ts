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
        // 09-Jun · Spec-mode fonts for the Analytics dashboard
        // (Account_Analytics_DevSpec_v3.html).
        manrope: ['"Manrope"', "system-ui", "sans-serif"],
        "plex-mono": ['"IBM Plex Mono"', "monospace"],
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
        // 09-Jun · DevSpec v4 palette — re-anchored on Beroe brand
        // Indigo (#4A00F8). The `teal-*` token NAMES are kept so JSX
        // class strings don't churn; only the underlying hex values
        // shift. Locked CLAUDE-memory brand palette ("Indigo /
        // Midnight / Bumblebee / Fuscia / Aqua + risk RAG + neutrals")
        // is the source of truth — this scale slots into it.
        analytics: {
          "teal-950": "#160550",
          "teal-900": "#210772",
          "teal-800": "#2e0a9e",
          "teal-700": "#3a0cc4",
          "teal-600": "#4a00f8",   // Beroe Indigo · primary
          "teal-500": "#6a2bff",
          "teal-400": "#8a5bff",
          "teal-300": "#b49bff",
          "teal-100": "#e2dafe",
          "teal-50":  "#f2eefe",
          ink:        "#171430",
          "ink-2":    "#454166",
          muted:      "#6f6a8e",
          line:       "#e3def0",
          "line-2":   "#f0edf8",
          bg:         "#f5f3fb",
          card:       "#ffffff",
          ok:         "#4a00f8",      // Indigo — primary signal
          "ok-bg":    "#f2eefe",
          derived:    "#0b7c70",      // teal-green — app/AI-derived
          "derived-bg":"#e3f4f2",
          offline:    "#c4811a",      // amber — offline/SharePoint
          "offline-bg":"#fbf2e2",
          pipe:       "#7a8a91",      // slate — pipeline needed
          "pipe-bg":  "#eef2f3",
          "danger":   "#c0392b",
          "danger-bg":"#fdecec",
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
