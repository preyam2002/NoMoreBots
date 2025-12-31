# AI Tweet Filter

A Chrome Extension that hides tweets on X/Twitter if they are predicted to be AI-generated.

## Structure

- `extension/`: Chrome Extension (Manifest V3, React, Vite)
- `api/`: Backend API (Next.js, Prisma, OpenAI)
- `shared/`: Shared TypeScript types

## Prerequisites

- Node.js (v18+)
- npm or pnpm
- OpenAI API Key (optional, defaults to mock mode)
- PostgreSQL (optional, for metrics)

## Setup

### 1. Backend (API)

```bash
cd api
npm install
# Create .env file with OPENAI_API_KEY="sk-..." and DATABASE_URL="..."
# For now, you can skip DB setup if you comment out Prisma code in route.ts
npm run dev
```

The API will run at `http://localhost:3000`.

### 2. Extension

```bash
cd extension
npm install
npm run build
```

### 3. Install in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked".
4. Select the `extension/dist` folder.

## Usage

1. Go to X (Twitter).
2. The extension will automatically scan tweets.
3. Click the extension icon to toggle the filter or adjust the sensitivity threshold.
4. Check the stats in the popup to see how many tweets were hidden.

## Development

- **Extension**: Run `npm run dev` in `extension/` to watch for changes. Note that you may need to reload the extension in Chrome for some changes to take effect.
- **API**: Run `npm run dev` in `api/`.
