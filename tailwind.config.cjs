const defaultTheme = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      borderRadius: {
        none: "0",
        xs: "0.375rem",
        sm: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        section: "2.5rem",
        full: "9999px",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
      },
      fontFamily: {
        heading: [
          "Nikolai",
          "Nikolai override",
          ...defaultTheme.fontFamily.serif,
        ],
        sans: ["Text", "Text override", ...defaultTheme.fontFamily.sans],
        mono: ["Mono", "Mono override", ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        DEFAULT: "1rem",
        headingOne: "2rem",
        lg: "1.125rem",
        md: "1rem",
        sm: "0.875rem",
        root: "16px",
      },
      lineHeight: {
        none: "0",
        one: "1",
        tight: "1.25",
        snug: "1.375",
        normal: "1.5",
        relaxed: "1.625",
        loose: "2",
      },
      maxWidth: (theme) => theme("spacing"),
      minWidth: (theme) => theme("spacing"),
      maxHeight: (theme) => theme("spacing"),
      minHeight: (theme) => theme("spacing"),
      screens: {
        xs: "340px",
        sm: "540px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        xxl: "1460px",
        "pointer-fine": { raw: "(pointer: fine)" },
      },
      spacing: {
        0: "0",
        px: "1px",
        0.125: "0.125rem",
        0.25: "0.25rem",
        0.5: "0.5rem",
        0.75: "0.75rem",
        1: "1rem",
        1.5: "1.5rem",
        2: "2rem",
        2.5: "2.5rem",
        3: "3rem",
        4: "4rem",
        5: "5rem",
        6: "6rem",
        8: "8rem",
        12: "12rem",
        16: "16rem",
        20: "20rem",
        24: "24rem",
        32: "32rem",
        40: "40rem",
        48: "48rem",
        64: "64rem",
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            "--tw-prose-body": theme("colors.secondary.foreground"),
            "--tw-prose-headings": theme("colors.primary.foreground"),
            "--tw-prose-lead": theme("colors.secondary.foreground"),
            "--tw-prose-links": theme("colors.primary.foreground"),
            "--tw-prose-bold": theme("colors.primary.foreground"),
            "--tw-prose-counters": theme("colors.muted.foreground"),
            "--tw-prose-bullets": theme("colors.muted.foreground"),
            "--tw-prose-hr": theme("colors.border"),
            "--tw-prose-quotes": theme("colors.secondary.foreground"),
            "--tw-prose-quote-borders": theme("colors.border"),
            "--tw-prose-captions": theme("colors.secondary.foreground"),
            "--tw-prose-code": theme("colors.secondary.foreground"),
            "--tw-prose-pre-code": theme("colors.secondary.foreground"),
            "--tw-prose-pre-bg": theme("colors.secondary"),
            "--tw-prose-th-borders": theme("colors.border"),
            "--tw-prose-td-borders": theme("colors.border"),
            h1: {
              fontWeight: "normal",
            },
            h2: {
              fontWeight: "normal",
              fontSize: theme("fontSize.lg"),
            },
            h3: {
              fontWeight: "normal",
            },
            h4: {
              fontWeight: "normal",
            },
            h5: {
              fontWeight: "normal",
            },
            h6: {
              fontWeight: "normal",
            },
            p: {
              margin: "0",
            },
            "p + p": {
              marginTop: theme("spacing.1"),
            },
            blockquote: {
              fontWeight: "normal",
              fontStyle: "normal",
              borderLeftWidth: theme("spacing.px"),
            },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
