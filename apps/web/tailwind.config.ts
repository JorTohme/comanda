import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FBF3EA",
        surface: "#FFFFFF",
        ink: "#2B2118",
        muted: "#8A7A68",
        hairline: "#EDE0D0",
        accent: { DEFAULT: "#C1552C", hover: "#A0431F" },
        secondary: "#A98600",
        success: "#16A34A",
        warning: "#A16207",
        danger: { DEFAULT: "#B3261E", light: "#FBEAE8" },
      },
      fontFamily: {
        serif: ["Lora", "serif"],
        sans: ["Work Sans", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(43,33,24,0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
