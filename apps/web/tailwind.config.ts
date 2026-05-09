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
        // Beroe brand palette — mirrors prototype `:root` block verbatim
        beroe: {
          bg: "#EAF1F5",
          card: "#ffffff",
          "card-border": "#e4eaf6",   // --cb
          navy: "#001137",            // --navy
          "navy-2": "#001a45",        // --n2
          "navy-3": "#002050",        // --n3
          "navy-4": "#001e52",        // --bd  (sidebar active bg, sb-btn.active)
          blue: "#4A00F8",
          teal: "#35E1D4",
          amber: "#EF9637",
          green: "#40CC8F",
          red: "#FD576B",
          purple: "#C344C7",
          coral: "#EF9637",
        },
        text: {
          primary: "#0d1b2e",
          secondary: "#5a7896",
          muted: "#8496b0",
          subtle: "#b0c0d0",
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
