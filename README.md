# 🎱 8-Ball Pool Game

A realistic 8-ball pool game built with Coding Agents

## Features

- **Local 2-Player Mode**: Play on the same device with turn-based gameplay
- **Online Multiplayer**: Host or join games using room codes
- **Realistic Physics**: Matter.js powered ball collisions and movement
- **Full Pool Mechanics**: 15 numbered balls, cue ball, 6 pockets, scratch detection
- **Visual Polish**: Billiard table, colored balls with rotation, cue stick, power meter

## Documentation

[deepwiki](https://deepwiki.com/josherich/tiny-pool)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js) or **yarn** or **pnpm**

### Installing Node.js

**macOS:**
```bash
# Using Homebrew
brew install node

# Or download from https://nodejs.org/
```

**Windows:**
- Download the installer from [nodejs.org](https://nodejs.org/)
- Run the installer and follow the prompts

**Linux:**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# Fedora
sudo dnf install nodejs npm
```

## Setup Instructions

### 1. Install Dependencies

Navigate to the project directory and install dependencies:

```bash
cd pool-game
npm install
```

Or if you prefer yarn:
```bash
yarn install
```

Or with pnpm:
```bash
pnpm install
```

### 2. Start Development Server

```bash
npm run dev
```

The game will be available at `http://localhost:5173` (or another port if 5173 is busy).

### 3. Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

### 4. Preview Production Build

```bash
npm run preview
```

## Project Structure

```
pool-game/
├── src/
│   ├── pool_game.tsx    # Main game component and engine
│   ├── App.tsx          # Root application component
│   ├── main.tsx         # Application entry point
│   └── index.css        # Global styles
├── index.html           # HTML template
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── vite.config.ts       # Vite configuration
└── README.md           # This file
```

## How to Play

### Local Mode
1. Click "Local 2-Player" on the main menu
2. Player 1 aims with the mouse and clicks to set power
3. Release to shoot
4. Players alternate turns

### Online Mode
1. **Host**: Click "Host Online Game" and share the room code
2. **Join**: Enter the room code and click "Join"
3. Take turns shooting when it's your turn

### Controls
- **Mouse Move**: Aim the cue stick
- **Mouse Down**: Start power meter
- **Mouse Up**: Shoot with current power

## Technologies Used

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Matter.js** - 2D physics engine (loaded via CDN)
- **Lucide React** - Icons
- **HTML5 Canvas** - Rendering

## Troubleshooting

### Port already in use
If port 5173 is busy, Vite will automatically use the next available port.

### Matter.js not loading
The game loads Matter.js from CDN. Ensure you have an internet connection.

### TypeScript errors
Run `npm run build` to see detailed TypeScript errors.

## License

MIT

## GitHub Pages Deployment

This repo includes a GitHub Actions workflow that builds the app and publishes `dist/` to the `gh-pages` branch on every push to `master`/`main`.

Live demo: https://josherich.github.io/tiny-pool/

To enable GitHub Pages:
1. Go to **Settings → Pages**
2. Set **Source** to **Deploy from a branch**
3. Select **Branch**: `gh-pages` and **Folder**: `/ (root)`
