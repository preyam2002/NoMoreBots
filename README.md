# NoMoreBots

A Chrome extension that filters AI-generated and low-quality content from your Twitter/X and LinkedIn feeds using AI-powered content analysis.

![Version](https://img.shields.io/badge/version-1.3.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### Core Functionality
- **AI Detection**: Uses multiple AI models (OpenAI, Claude, Gemini) to detect AI-generated content
- **Real-time Scanning**: Automatically scans tweets as you scroll through your timeline
- **Adjustable Sensitivity**: Set threshold from 50% to 95%
- **Smart Filtering**: Hides content above your threshold with a clean overlay

### Content Filters
- **Engagement Farming**: Filter tweets asking for likes, retweets, or followers
- **Ragebait**: Block intentionally provocative content
- **Hate Speech**: Automatically hide harmful content
- **Racism**: Catch race- or ethnicity-targeted hostility separately
- **Vague Posting**: Filter cryptic grievance and drama-bait posts
- **Fearmongering**: Reduce panic-driven, alarmist posting

### Rules System
- **Whitelist**: Always show tweets from trusted accounts
- **Blacklist**: Always hide specific accounts
- **Keywords**: Block tweets containing specific words
- **Import/Export**: Backup and share your rules

### Analytics & Dashboard
- **Statistics Dashboard**: Track scanned/hidden counts
- **Time Saved**: Estimated time saved from not reading bot content
- **Usage Tracking**: Monitor API requests and limits
- **Tabbed Interface**: Overview, Filters, Rules, Analytics

### Plans
- **Free**: Twitter/X scanning, Gemini detection, blur mode, 100 daily requests
- **Pro**: LinkedIn scanning, provider selection, advanced filters, geo rules, richer analytics

## Tech Stack

### Extension (Chrome)
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS
- **Manifest**: V3 with Service Worker
- **Icons**: Custom SVG icons

### Backend (API)
- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL with Prisma ORM (Supabase-friendly)
- **AI Providers**: OpenAI, Anthropic, Google Gemini
- **Validation**: Zod
- **Testing**: Jest

## Quick Start

### Prerequisites
- Node.js 18+
- npm or pnpm
- Chrome browser
- PostgreSQL database (Supabase or local Docker)
- API key from at least one AI provider (OpenAI, Anthropic, or Google)

### Installation

1. **Clone and setup**
```bash
cd NoMoreBots
```

2. **Setup the API**
```bash
docker compose up -d db
cd api
npm install
cp .env.example .env.local
# Edit .env.local with your Postgres/Supabase connection strings and API keys
npm run db:migrate:deploy
npm run dev
```

3. **Setup the Extension**
```bash
cd extension
npm install
cp .env.example .env
npm run build
```

4. **Install in Chrome**
- Open `chrome://extensions`
- Enable "Developer mode"
- Click "Load unpacked"
- Select `extension/dist` folder

### Environment Variables

#### API (`api/.env.local`)
```env
# Supabase or Postgres runtime connection
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require"

# Direct connection for Prisma migrations
DIRECT_URL="postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require"

# At least one required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# Optional (for payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...

# App URL
NEXT_PUBLIC_APP_URL=https://your-api-domain.com

# Optional hard timeout for provider calls (milliseconds)
AI_PROVIDER_TIMEOUT_MS=12000
```

For Supabase, use the exact pooled/runtime and direct strings from the project's Connect panel. `DATABASE_URL` is used by the running app, and `DIRECT_URL` is used by Prisma migrations.

#### Extension (`extension/.env`)
```env
VITE_API_BASE_URL=https://your-api-domain.com
```

Production builds enforce HTTPS, non-localhost values for both `NEXT_PUBLIC_APP_URL` and `VITE_API_BASE_URL`.

## Usage

### Basic Operations

1. **Enable/Disable**: Toggle the filter from the extension popup
2. **Adjust Sensitivity**: Use the slider to set how strict detection should be
3. **Add Rules**: Go to the Rules tab to whitelist/blacklist accounts
4. **Configure Filters**: Enable engagement farming, ragebait, hate speech, racism, vague-posting, or fearmongering filters
5. **View Analytics**: Check the dashboard for usage statistics

### Keyboard Shortcuts
- `Ctrl+Shift+B` / `Cmd+Shift+B`: Toggle filter
- `Ctrl+Shift+S` / `Cmd+Shift+S`: Show stats

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/classify` | POST | Classify tweets for AI content |
| `/api/register` | POST | Mint a client token for the extension |
| `/api/stats` | GET | Get user statistics |
| `/api/settings` | POST | Update filter preferences |
| `/api/rules` | GET/POST/DELETE | Manage whitelist/blacklist rules |
| `/api/health` | GET | Health check |
| `/api/checkout` | POST | Create Stripe checkout session |

### Classification Request
```typescript
POST /api/classify
Headers:
  x-user-id: string (required)
  x-client-token: string (required)
  x-api-key: string (optional)
  x-provider: "openai" | "gemini" | "anthropic" (optional)

Body:
{
  tweets: [{
    id: string,
    text: string,
    authorHandle: string (optional),
    context: string (optional),
    quotedText: string (optional),
    mediaSummary: string (optional),
    isReply: boolean (optional),
    platform: "twitter" | "linkedin" (optional)
  }]
}

Response:
{
  results: [{
    tweetId: string,
    aiProbability: number (0-1),
    label: "ai" | "human" | "engagement" | "ragebait" | "hate_speech" | "racism" | "vague_posting" | "fearmongering",
    reason: string,
    cached: boolean
  }],
  usage: {
    requestCount: number,
    dailyLimit: number,
    remaining: number
  },
  plan: "FREE" | "PRO"
}
```

## Project Structure

```
NoMoreBots/
├── api/                          # Next.js Backend
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── classify/     # Classification endpoint
│   │   │   │   ├── register/     # Client registration/token minting
│   │   │   │   ├── rules/       # Rules CRUD
│   │   │   │   ├── settings/    # Filter settings
│   │   │   │   ├── stats/       # User statistics
│   │   │   │   └── health/      # Health check
│   │   │   └── dashboard/       # Dashboard page
│   │   └── lib/
│   │       ├── llm.ts          # AI provider integration
│   │       ├── auth.ts         # Client token validation
│   │       ├── prisma.ts       # Database client
│   │       ├── ratelimit.ts    # Postgres-backed rate limiting
│   │       └── env.ts          # Environment validation
│   └── prisma/
│       └── schema.prisma       # Database schema
│
├── extension/                    # Chrome Extension
│   ├── src/
│   │   ├── background/         # Service worker
│   │   │   └── index.ts       # Command handling, analytics
│   │   ├── content/            # Content script
│   │   │   └── index.ts       # Tweet detection, filtering
│   │   └── popup/             # Extension popup UI
│   │       ├── App.tsx        # Main popup component
│   │       └── ...
│   ├── manifest.config.ts      # Manifest V3 (env-aware)
│   └── icons/                  # Extension icons (SVG)
│
└── shared/                      # Shared TypeScript types
    └── types.ts
```

## Development

### Running Locally

```bash
# Terminal 1: API
cd api
npm run dev

# Terminal 2: Extension (for HMR)
cd extension
npm run dev
```

### Building for Production

```bash
# Build extension
cd extension
npm run build

# Build API
cd api
npm run build
```

### Production Checklist

```bash
# 1. Point the extension at your deployed API
cd extension
cp .env.example .env
# Set VITE_API_BASE_URL=https://your-api.example.com

# 2. Configure the API
cd ../api
cp .env.example .env.local
# Set DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_APP_URL, AI keys, Stripe keys, and price IDs

# 3. Run migrations
npm run db:migrate:deploy

# 4. Verify before deploy
npm test -- --runInBand
npm run build
cd ../extension && npm run build
```

### Production Notes

- The extension now registers itself with a server-minted client token. API routes used by the extension require both `x-user-id` and `x-client-token`.
- Minute-based rate limiting is stored in Postgres, so the limit is shared across instances instead of resetting per process.
- Supabase works as the production database without code changes; update only `DATABASE_URL` and `DIRECT_URL`.

### Testing

```bash
# Run API tests
cd api
npm run test
npm run test:coverage
```

## Architecture

### Content Script Flow
```
1. Inject into twitter.com/x.com
2. Observe DOM mutations for new tweets
3. Extract tweet text and metadata
4. Batch tweets (up to 10)
5. Send to background script for classification
6. Receive AI probability scores
7. Hide tweets above threshold
8. Update stats in storage
```

### Background Script
```
1. Handle messages from content script
2. Proxy requests to API (avoid CORS)
3. Track keyboard commands
4. Handle extension lifecycle events
5. Periodic sync and analytics
```

### API Flow
```
1. Receive classification request
2. Check rate limits
3. Validate request
4. Check cache (Prisma)
5. Apply user rules (whitelist/blacklist/keywords)
6. Call AI provider (OpenAI/Claude/Gemini)
7. Apply content filters
8. Store results in cache
9. Update user stats
10. Return classification
```

## Security

- **API Keys**: User-provided keys take precedence over system keys
- **Rate Limiting**: 60 requests per minute per IP
- **Daily Limits**: 100 free requests/day (configurable)
- **Privacy**: No tweet content is stored without classification
- **User Isolation**: Each user can only access their own rules

## Roadmap

- [x] Multi-provider AI support
- [x] Content filters (engagement, ragebait, hate speech)
- [x] Rules system with import/export
- [x] Analytics dashboard with tabs
- [x] Keyboard shortcuts
- [ ] Mobile app
- [ ] Firefox extension
- [ ] Custom ML model training
- [ ] Community rule sharing
- [ ] Browser notifications

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: Report bugs via GitHub Issues
- **Email**: support@nomorebots.app

---

Built with ❤️ to make social media a better place.
