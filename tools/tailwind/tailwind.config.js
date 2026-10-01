// Build: npx tailwindcss@3 -c tools/tailwind/tailwind.config.js -i tools/tailwind/input.css -o assets/tailwind.css --minify   (run from repo root)
module.exports = {
  content: ['./index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        brand: { cyan: '#22d3ee', blue: '#3b82f6', violet: '#a78bfa', emerald: '#34d399', dark: '#05070d' },
      },
    },
  },
};
