const DEFAULT_API_BASE_URL = "http://localhost:3000";

function getApiOrigin(apiBaseUrl: string) {
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

export function createManifest(apiBaseUrl: string) {
  const apiOrigin = getApiOrigin(apiBaseUrl);

  return {
    manifest_version: 3,
    name: "NoMoreBots - AI Tweet Filter",
    version: "1.3.1",
    description:
      "Filter AI-generated and low-quality content from your Twitter/X feed using AI-powered analysis.",
    permissions: ["storage", "activeTab", "tabs", "notifications"],
    host_permissions: [
      "*://*.twitter.com/*",
      "*://*.x.com/*",
      "*://*.linkedin.com/*",
      `${apiOrigin}/*`,
    ],
    action: {
      default_popup: "src/popup/index.html",
      default_icon: {
        "16": "icons/icon16.svg",
        "32": "icons/icon32.svg",
        "48": "icons/icon48.svg",
        "128": "icons/icon128.svg",
      },
    },
    icons: {
      "16": "icons/icon16.svg",
      "32": "icons/icon32.svg",
      "48": "icons/icon48.svg",
      "128": "icons/icon128.svg",
    },
    content_scripts: [
      {
        matches: ["*://*.twitter.com/*", "*://*.x.com/*", "*://*.linkedin.com/*"],
        js: ["src/content/index.ts"],
        run_at: "document_idle" as const,
      },
    ],
    background: {
      service_worker: "src/background/index.ts",
      type: "module" as const,
    },
    commands: {
      "toggle-filter": {
        suggested_key: {
          default: "Ctrl+Shift+B",
          mac: "Command+Shift+B",
        },
        description: "Toggle the AI filter on/off",
      },
      "show-stats": {
        suggested_key: {
          default: "Ctrl+Shift+S",
          mac: "Command+Shift+S",
        },
        description: "Show extension stats popup",
      },
    },
  };
}
