/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    const allowedOrigins = [
      "chrome-extension://*",
      "moz-extension://*",
    ];

    const envProductionUrl = process.env.PRODUCTION_URL;
    if (envProductionUrl) {
      allowedOrigins.push(envProductionUrl);
    }

    const corsHeaders = [
      { key: "Access-Control-Allow-Credentials", value: "true" },
      { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
      { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-User-Id, X-Api-Key, X-Provider" },
    ];

    return [
      {
        source: "/api/:path*",
        headers: [
          ...corsHeaders,
          { key: "Access-Control-Allow-Origin", value: allowedOrigins.join(" ") },
        ],
      },
      {
        source: "/dashboard",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
