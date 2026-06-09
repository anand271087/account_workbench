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
        // 09-Jun · Spec palette from Account_Analytics_DevSpec_v3.html
        // — scoped to the `analytics-*` namespace so it doesn't bleed
        // into the global brand. Used by the Analytics charts only.
        analytics: {
          "teal-950": "#063038",
          "teal-900": "#0a4a54",
          "teal-800": "#0b5e6b",
          "teal-700": "#0c7c8c",
          "teal-600": "#0e8fa3",
          "teal-500": "#129aad",
          "teal-400": "#3bb3c2",
          "teal-300": "#7fd0db",
          "teal-100": "#cdeef2",
          "teal-50":  "#e9f7f9",
          ink:        "#0f2228",
          "ink-2":    "#3a5158",
          muted:      "#6a8088",
          line:       "#dce8ea",
          "line-2":   "#eef4f5",
          bg:         "#f3f7f8",
          card:       "#ffffff",
          ok:         "#0e8fa3",
          "ok-bg":    "#e9f7f9",
          derived:    "#5b54c9",
          "derived-bg":"#eeedfb",
          offline:    "#c4811a",
          "offline-bg":"#fbf2e2",
          pipe:       "#7a8a91",
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
