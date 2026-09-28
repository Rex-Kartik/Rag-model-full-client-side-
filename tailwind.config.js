/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "background": "var(--color-background)",
        "surface": "var(--color-surface)",
        "surface-container-lowest": "var(--color-surface-container-lowest)",
        "surface-container-low": "var(--color-surface-container-low)",
        "surface-container": "var(--color-surface-container)",
        "surface-container-high": "var(--color-surface-container-high)",
        "surface-container-highest": "var(--color-surface-container-highest)",
        "on-surface": "var(--color-on-surface)",
        "on-surface-variant": "var(--color-on-surface-variant)",
        "outline": "var(--color-outline)",
        "outline-variant": "var(--color-outline-variant)",
        "primary": "var(--color-primary)",
        "on-primary": "var(--color-on-primary)",
        "primary-container": "var(--color-primary-container)",
        "on-primary-container": "var(--color-on-primary-container)",
        "secondary": "var(--color-secondary)",
        "on-secondary": "var(--color-on-secondary)",
        "secondary-container": "var(--color-secondary-container)",
        "on-secondary-container": "var(--color-on-secondary-container)",
        "tertiary": "var(--color-tertiary)",
        "on-tertiary": "var(--color-on-tertiary)",
        "error": "var(--color-error)",
        "on-error": "var(--color-on-error)",
        "error-container": "var(--color-error-container)",
        "on-error-container": "var(--color-on-error-container)"
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem"
      },
      spacing: {
        "space-md": "0.75rem",
        "space-xl": "2rem",
        "gutter-dense": "0.5rem",
        "gutter": "1rem",
        "space-xs": "0.25rem",
        "margin-mobile": "1rem",
        "space-sm": "0.5rem",
        "space-lg": "1.25rem",
        "margin": "1.5rem"
      },
      fontFamily: {
        "body-sm": ["Inter"],
        "label-md": ["Inter"],
        "body-md": ["Inter"],
        "headline-sm": ["Inter"],
        "display-lg-mobile": ["Inter"],
        "body-lg": ["Inter"],
        "code-sm": ["JetBrains Mono"],
        "display-lg": ["Inter"],
        "code-md": ["JetBrains Mono"],
        "label-code": ["JetBrains Mono"],
        "headline-md": ["Inter"]
      },
      fontSize: {
        "body-sm": ["12px", { lineHeight: "18px", letterSpacing: "0em", fontWeight: "400" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.01em", fontWeight: "500" }],
        "body-md": ["13px", { lineHeight: "20px", letterSpacing: "0em", fontWeight: "400" }],
        "headline-sm": ["16px", { lineHeight: "24px", letterSpacing: "-0.005em", fontWeight: "600" }],
        "display-lg-mobile": ["26px", { lineHeight: "34px", letterSpacing: "-0.015em", fontWeight: "600" }],
        "body-lg": ["15px", { lineHeight: "24px", letterSpacing: "0em", fontWeight: "400" }],
        "code-sm": ["11px", { lineHeight: "16px", letterSpacing: "0em", fontWeight: "500" }],
        "display-lg": ["32px", { lineHeight: "40px", letterSpacing: "-0.02em", fontWeight: "600" }],
        "code-md": ["13px", { lineHeight: "20px", letterSpacing: "-0.01em", fontWeight: "400" }],
        "label-code": ["10px", { lineHeight: "14px", letterSpacing: "0.04em", fontWeight: "600" }],
        "headline-md": ["20px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "600" }]
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-up": "slide-up 0.3s ease-out"
      }
    }
  },
  plugins: [],
}
