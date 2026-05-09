import type { Config } from 'tailwindcss';

/**
 * Token set mirrored from apex_core_cbs/apps/banking/tailwind.config.ts.
 * DO NOT add raw hex values to TSX — reference these tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Brand ────────────────────────────────────────────────
        brand: {
          navy:      '#0D2B6A',
          blue:      '#1565C0',
          blueHover: '#104a94',
          sky:       '#2196F3',
          skyLight:  '#E3EFFF',
          // Tenant-driven token (CC2). Reads the CSS custom property set by
          // App.tsx once the tenant payload resolves. Existing brand.* tokens
          // are static fallbacks and remain unchanged.
          primary:   'var(--brand-primary)',
        },

        // Sidebar + action aliases
        sidebar:         '#0D2B6A',
        'sidebar-hover': '#1A3B85',
        'sidebar-text':  '#A5C3EB',
        action:          '#1565C0',
        'action-hover':  '#104a94',
        'action-subtle': '#E3EFFF',

        // ── Semantic (DEFAULT + bg) ─────────────────────────────
        success: { DEFAULT: '#1D9E75', bg: '#E0F5EE' },
        warning: { DEFAULT: '#EF9F27', bg: '#FAF0DC' },
        danger:  { DEFAULT: '#E24B4A', bg: '#FCEBEB' },
        purple:  { DEFAULT: '#7F77DD', bg: '#EEEDFE' },

        // Legacy aliases kept for compatibility with apex-derived code
        ok:   { DEFAULT: '#1D9E75', bg: '#E0F5EE' },
        warn: { DEFAULT: '#EF9F27', bg: '#FAF0DC' },
        risk: { DEFAULT: '#E24B4A', bg: '#FCEBEB' },

        // ── Neutrals ────────────────────────────────────────────
        ink:            '#2C2C2A',
        'ink-sub':      '#5F5E5A',
        sub:            '#5F5E5A',
        muted:          '#888780',
        border:         '#D3D1C7',
        borderMed:      '#B9B7AE',
        divider:        '#F1EFE8',
        raised:         '#F7F6F2',
        surface:        '#FFFFFF',
        'surface-alt':  '#F7F6F2',
        page:           '#F1F4F8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        card:  '12px',
        badge: '11px',
        input: '8px',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs:   ['11px', { lineHeight: '16px' }],
        sm:   ['12px', { lineHeight: '18px' }],
        base: ['13px', { lineHeight: '20px' }],
        md:   ['14px', { lineHeight: '22px' }],
        lg:   ['16px', { lineHeight: '24px' }],
        xl:   ['20px', { lineHeight: '28px' }],
        '2xl':['28px', { lineHeight: '36px' }],
      },
      boxShadow: {
        card:         '0 1px 2px 0 rgba(16, 24, 40, 0.04)',
        'ai-glow':    '0 0 24px 4px rgba(21, 101, 192, 0.22), 0 0 48px 8px rgba(33, 150, 243, 0.10)',
        'ai-halo':    '0 0 0 6px rgba(21, 101, 192, 0.18), 0 0 0 12px rgba(33, 150, 243, 0.08)',
        'ai-field':   '0 0 8px 0 rgba(21, 101, 192, 0.25)',
        'ai-btn':     '0 0 16px 2px rgba(21, 101, 192, 0.35)',
        'ai-btn-hover': '0 0 24px 4px rgba(21, 101, 192, 0.55)',
      },
      keyframes: {
        'ai-halo-outer': {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%':      { opacity: '0.15', transform: 'scale(1.5)' },
        },
        'ai-halo-inner': {
          '0%, 100%': { opacity: '0.8', transform: 'scale(1)' },
          '50%':      { opacity: '0.2', transform: 'scale(1.3)' },
        },
        'ai-connector-flow': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
        'ai-scan-line': {
          '0%':   { top: '0%',   opacity: '0' },
          '5%':   { opacity: '1' },
          '95%':  { opacity: '1' },
          '100%': { top: '100%', opacity: '0' },
        },
        'ai-shimmer': {
          '0%':   { transform: 'translateX(-100%) skewX(-20deg)', opacity: '0' },
          '30%':  { opacity: '1' },
          '70%':  { opacity: '1' },
          '100%': { transform: 'translateX(250%) skewX(-20deg)', opacity: '0' },
        },
        'ai-sparkle': {
          '0%, 100%': { opacity: '0', transform: 'scale(0.5)' },
          '50%':      { opacity: '1', transform: 'scale(1.2)' },
        },
        'ai-badge-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        'ai-breathe': {
          '0%, 100%': { opacity: '0.5', transform: 'scale(0.95)' },
          '50%':      { opacity: '1',   transform: 'scale(1.05)' },
        },
      },
      animation: {
        'ai-halo-outer':      'ai-halo-outer 2s ease-in-out infinite',
        'ai-halo-inner':      'ai-halo-inner 2s ease-in-out infinite 0.3s',
        'ai-connector-flow':  'ai-connector-flow 1.6s linear infinite',
        'ai-scan-line':       'ai-scan-line 2s ease-in-out infinite',
        'ai-shimmer':         'ai-shimmer 3s ease-in-out infinite',
        'ai-sparkle':         'ai-sparkle 1.5s ease-in-out infinite',
        'ai-badge-pulse':     'ai-badge-pulse 1.2s ease-in-out infinite',
        'ai-breathe':         'ai-breathe 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
