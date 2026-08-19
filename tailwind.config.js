/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Zoom17 brand palette, sampled from the wordmark: bright blue for
        // primary actions, deep navy for emphasis.
        brand: {
          blue: '#1A6CFF',
          bluedark: '#16277B',
          bluehover: '#0F55E0',
          navy: '#16277B',
          orange: '#F97316',
        },
        ink: {
          900: '#101828',
          700: '#344054',
          500: '#667085',
          400: '#98A2B3',
          200: '#EAECF0',
          100: '#F2F4F7',
          50: '#F9FAFB',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.04)',
        soft: '0 4px 20px rgba(16,24,40,0.06)',
      },
    },
  },
  plugins: [],
}
