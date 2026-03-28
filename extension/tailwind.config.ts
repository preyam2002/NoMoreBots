import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
    "./public/**/*.html",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
