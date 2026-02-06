# NoMoreBots

A Chrome extension that filters AI-generated tweets on X (Twitter) using AI-powered content analysis.

## Overview

NoMoreBots is a browser extension that helps you clean up your X/Twitter feed by detecting and hiding tweets that are likely AI-generated. It uses multiple AI models to analyze tweet content and provides adjustable sensitivity settings.

## Project Structure

```
NoMoreBots/
├── api/                          # Next.js backend API
│   ├── package.json
│   ├── prisma/                   # Prisma schema and migrations
│   ├── src/
│   │   └── app/
│   │       └── api/
│   │           └── analyze/
│   │               └── route.ts  # Tweet analysis endpoint
│   └── ...
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── package.json
│   ├── src/
│   │   ├── background.ts         # Service worker
│   │   ├── content.ts            # Content script for X/Twitter
│   │   ├── popup.tsx             # Extension popup UI
│   │   └── App.tsx               # Popup component
│   ├── manifest.json
│   └── vite.config.ts
└── shared/                       # Shared TypeScript types
    └── types.ts
```

## Features

- **Real-time tweet scanning**: Automatically scans tweets as you scroll through your X/Twitter timeline
- **AI detection**: Uses multiple AI providers (OpenAI, Claude, Gemini) to detect AI-generated content
- **Adjustable sensitivity**: Set threshold for what gets filtered (0-100 scale)
- **Statistics tracking**: Count of hidden tweets displayed in popup
- **Toggle control**: Enable/disable filtering with one click
- **Clean UI**: Simple popup interface with stats and controls

## Tech Stack

### Extension
- **Framework**: React 18.2.0 + TypeScript 5
- **Build Tool**: Vite 5.1.6
- **Styling**: Tailwind CSS 3.4.1
- **Chrome Extension**: Manifest V3 with @crxjs/vite-plugin 2.0.0-beta.23
- **Chrome Types**: @types/chrome 0.0.263

### API
- **Framework**: Next.js 14.1.0
- **Language**: TypeScript
- **ORM**: Prisma 5.10.0 with @prisma/client
- **Database**: PostgreSQL (via Prisma)
- **AI Providers**:
  - OpenAI SDK 4.28.0
  - Anthropic SDK 0.71.0
  - Google Generative AI 0.24.1
- **Validation**: Zod 3.22.4
- **Payments**: Stripe 20.0.0
- **Testing**: Jest 29.7.0 with ts-jest

## Prerequisites

- Node.js 18+
- npm or pnpm
- Chrome browser
- OpenAI API Key (or Anthropic/Google key)
- PostgreSQL database (optional, for metrics)

## Setup

### 1. Backend (API)

```bash
cd api

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Edit .env.local:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_API_KEY=...
# DATABASE_URL=postgresql://...

# Generate Prisma client
npm run postinstall

# Run development server
npm run dev
```

The API will run at `http://localhost:3000`.

### 2. Extension

```bash
cd extension

# Install dependencies
npm install

# Build extension
npm run build

# Or run in development mode
npm run dev
```

### 3. Install in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/dist` folder
5. The extension icon should appear in your toolbar

## NPM Scripts

### API
```bash
npm run dev              # Start dev server
npm run build            # Build Next.js app
npm run start            # Start production server
npm run lint             # Run ESLint
npm run test             # Run Jest tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
npm run postinstall      # Generate Prisma client
```

### Extension
```bash
npm run dev              # Start Vite dev server
npm run build            # Build extension
npm run preview          # Preview built extension
```

## Usage

1. Navigate to X (Twitter)
2. The extension automatically begins scanning tweets as they load
3. Click the extension icon to:
   - Toggle the filter on/off
   - Adjust sensitivity threshold (0-100)
   - View statistics (tweets scanned, hidden)
4. Tweets scoring above your threshold are automatically hidden from view

## How It Works

1. **Content Script Injection**: The extension injects a content script into x.com/twitter.com
2. **Tweet Detection**: Monitors DOM for new tweets as you scroll
3. **API Analysis**: Sends tweet text to the backend API
4. **AI Scoring**: Multiple AI models analyze content for AI-generated patterns:
   - Generic phrasing
   - Repetitive structures
   - Common AI writing patterns
5. **Threshold Comparison**: AI score compared to user-set threshold
6. **DOM Manipulation**: High-scoring tweets are hidden from view
7. **Stats Update**: Hidden count updated in real-time

## Development

### Extension Development

```bash
cd extension
npm run dev
```

Changes are watched automatically. Note: You may need to reload the extension in Chrome (`chrome://extensions` → refresh icon) for some changes to take effect.

### API Development

```bash
cd api
npm run dev
```

The API provides:
- `POST /api/analyze` - Analyze tweet text for AI patterns
- Response: `{ "aiProbability": number, "confidence": number }`

## Environment Variables

### API (.env.local)
```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=sk_test_...
```

## Testing

```bash
cd api
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

Tests cover:
- Tweet analysis endpoint
- AI provider integrations
- Prisma database operations

## Roadmap

- [ ] Support for more platforms (Reddit, LinkedIn, Facebook)
- [ ] Custom AI model training for better detection
- [ ] Community-driven sensitivity profiles
- [ ] Export/import settings
- [ ] Statistics dashboard with historical data
- [ ] Whitelist/blacklist specific accounts

## Author

**Preyam** - [GitHub](https://github.com/preyam2002)

## License

MIT
