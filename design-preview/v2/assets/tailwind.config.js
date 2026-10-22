// Tailwind chỉ dùng cho layout (grid/flex/spacing). Màu & component lấy từ token trong theme.css.
tailwind.config = {
  corePlugins: { preflight: true },
  theme: {
    extend: {
      colors: Object.fromEntries([
        'bg', 'surface', 'subtle', 'muted', 'border', 'border-strong', 'text', 'text-2', 'text-3',
        'primary', 'primary-soft', 'ok', 'ok-soft', 'warn', 'warn-soft', 'danger', 'danger-soft',
      ].map(name => [name, `var(--${name})`])),
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      borderRadius: { DEFAULT: '10px', lg: '14px' },
    },
  },
};
