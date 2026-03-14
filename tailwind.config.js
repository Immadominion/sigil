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
          bg: "#050505",
          surface: "#111111",
          border: "#222222",
          accent: "#FF4500",
          "accent-light": "#FF5c19",
          success: "#3fb950",
          warning: "#d29922",
          danger: "#f85149",
          muted: "#888888",
          text: "#F5F5F5"
        },
      },
      fontFamily: {
        mono: ['SpaceMono']
      }
    },
  },
  plugins: [],
};
