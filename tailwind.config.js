/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        sigil: {
          bg: "#0d1117",
          surface: "#161b22",
          border: "#30363d",
          accent: "#58a6ff",
          "accent-light": "#58a6ff",
          success: "#3fb950",
          warning: "#d29922",
          danger: "#f85149",
          muted: "#8b949e",
        },
      },
    },
  },
  plugins: [],
};
