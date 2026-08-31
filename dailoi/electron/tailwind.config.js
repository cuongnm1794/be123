/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src-renderer/**/*.{js,ts,jsx,tsx}",
    "./renderer/**/*.{js,ts,jsx,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#e0eaff',
          500: '#667eea',
          600: '#5a67d8',
          700: '#4c51bf',
        },
        secondary: {
          500: '#764ba2',
          600: '#6b46c1',
        }
      }
    },
  },
  plugins: [],
}