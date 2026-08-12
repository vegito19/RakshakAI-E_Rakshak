/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          base: '#111010',
          panel: '#171513',
          secondary: '#1D1A17',
          border: '#332E28',
          gold: '#C9A961',
          'gold-dim': '#8C7647',
          text: '#E8E4DC',
          muted: '#9A948A',
          brick: '#A6423A',
          forest: '#4C7A63',
          amber: '#B9873F'
        },
        slate: {
          950: '#111010',
          900: '#171513',
          850: '#1D1A17',
          800: '#1D1A17',
          700: '#332E28',
          600: '#9A948A',
          500: '#9A948A',
          400: '#9A948A',
          350: '#9A948A',
          300: '#E8E4DC',
          200: '#E8E4DC',
          100: '#E8E4DC',
        },
        cyan: {
          100: '#E8E4DC',
          200: '#C9A961',
          300: '#C9A961',
          400: '#C9A961',
          500: '#C9A961',
          600: '#8C7647',
          700: '#8C7647',
          800: '#332E28',
          900: '#1D1A17',
          950: '#171513'
        },
        emerald: {
          100: '#E8E4DC',
          200: '#4C7A63',
          300: '#4C7A63',
          400: '#4C7A63',
          500: '#4C7A63',
          600: '#4C7A63',
          700: '#332E28',
          800: '#1D1A17',
          900: '#171513'
        },
        red: {
          100: '#E8E4DC',
          200: '#A6423A',
          300: '#A6423A',
          400: '#A6423A',
          500: '#A6423A',
          600: '#A6423A',
          700: '#332E28',
          800: '#1D1A17',
          900: '#171513'
        },
        amber: {
          100: '#E8E4DC',
          200: '#B9873F',
          300: '#B9873F',
          400: '#B9873F',
          500: '#B9873F',
          600: '#B9873F',
          700: '#332E28',
          800: '#1D1A17',
          900: '#171513'
        },
        purple: {
          100: '#E8E4DC',
          200: '#8C7647',
          300: '#8C7647',
          400: '#8C7647',
          500: '#8C7647',
          600: '#8C7647',
        },
        indigo: {
          100: '#E8E4DC',
          200: '#8C7647',
          300: '#8C7647',
          400: '#8C7647',
          500: '#8C7647',
          600: '#8C7647',
        },
        white: '#E8E4DC'
      },
      fontFamily: {
        heading: ['Fraunces', 'serif'],
        sans: ['Source Serif 4', 'Georgia', 'serif'],
        serif: ['Source Serif 4', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
