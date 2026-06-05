import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        matrix: {
          bg: "rgb(var(--background) / <alpha-value>)",
          fg: "rgb(var(--foreground) / <alpha-value>)",
          panel: "rgb(var(--card) / <alpha-value>)",
          panel2: "rgb(var(--card-strong) / <alpha-value>)",
          border: "rgb(var(--border) / <alpha-value>)",
          muted: "rgb(var(--muted-foreground) / <alpha-value>)",
          gold: "rgb(var(--gold) / <alpha-value>)",
          goldSoft: "rgb(var(--gold-soft) / <alpha-value>)",
          goldDark: "rgb(var(--gold-dark) / <alpha-value>)",
          green: "#22c55e",
          purple: "#a855f7",
          blue: "#38bdf8",
          orange: "#f97316",
          red: "#ef4444"
        }
      },
      boxShadow: {
        glow: "0 18px 50px rgb(var(--shadow) / 0.12)",
        gold: "0 12px 32px rgb(var(--gold) / 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
