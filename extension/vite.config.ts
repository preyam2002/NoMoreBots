import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { createManifest } from "./manifest.config";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function validateApiBaseUrl(apiBaseUrl: string, mode: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error(`VITE_API_BASE_URL must be a valid URL. Received: ${apiBaseUrl}`);
  }

  if (mode === "production") {
    if (parsedUrl.protocol !== "https:" || LOCAL_HOSTNAMES.has(parsedUrl.hostname)) {
      throw new Error(
        "Production builds require VITE_API_BASE_URL to be an HTTPS, non-localhost URL."
      );
    }
  }

  return parsedUrl.toString().replace(/\/$/, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = validateApiBaseUrl(
    env.VITE_API_BASE_URL || env.VITE_API_URL || "http://localhost:3000",
    mode
  );

  return {
    plugins: [react(), crx({ manifest: createManifest(apiBaseUrl) })],
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: "./tailwind.config.ts" }),
          autoprefixer(),
        ],
      },
    },
    resolve: {
      alias: {
        "@shared": "../shared",
      },
    },
  };
});
