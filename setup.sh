#!/bin/bash

# NoMoreBots Setup Script
# This script sets up the project for development

set -e

echo "🤖 NoMoreBots Setup Script"
echo "=========================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version must be 18 or higher. Current: $(node -v)"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

print_status "Prerequisites checked"
echo ""

# Setup API
echo "Setting up API..."
cd api

if [ ! -f ".env.local" ]; then
    print_warning ".env.local not found. Creating from example..."
    cp .env.example .env.local
    print_status "Created .env.local"
    print_warning "Please edit .env.local and add your API keys!"
else
    print_status ".env.local already exists"
fi

echo "Installing API dependencies..."
npm install
print_status "API dependencies installed"

echo "Generating Prisma client..."
npm run postinstall 2>/dev/null || npx prisma generate
print_status "Prisma client generated"

echo ""
print_status "API setup complete!"
cd ..

# Setup Extension
echo ""
echo "Setting up Extension..."
cd extension

if [ ! -f ".env" ]; then
    print_warning ".env not found. Creating from example..."
    cp .env.example .env
    print_status "Created .env"
else
    print_status ".env already exists"
fi

echo "Installing Extension dependencies..."
npm install
print_status "Extension dependencies installed"

echo ""
cd ..
print_status "Extension setup complete!"

echo ""
echo "=========================="
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit 'api/.env.local' and add your API keys"
echo "2. Start the API: cd api && npm run dev"
echo "3. Start the Extension: cd extension && npm run dev"
echo "4. Build the extension: cd extension && npm run build"
echo "5. Load the extension in Chrome from extension/dist"
echo ""
echo "For more information, see README.md"
