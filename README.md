# Chess Playalong

A feature-rich, browser-based chess analysis tool that combines interactive gameplay with real-time Stockfish engine analysis, opening book data from the Lichess Masters database, and AI-powered move explanations using Claude.

## Features

### Interactive Chessboard
- Drag-and-drop piece movement with full rules enforcement
- Castling, en passant, and pawn promotion support
- Flip board orientation
- New game / undo functionality
- Load positions from FEN notation

### Engine Analysis
- Real-time Stockfish analysis (depth 18)
- Multi-PV analysis showing top 4 candidate moves
- Visual evaluation bar with win probability
- Move rankings by strength
- Hover preview to see candidate move destinations on the board
- Click any candidate move to play it on the board

### Opening Book Integration
- Masters games statistics for the current position
- ECO opening classification and naming
- Win rate breakdown (White wins / Draws / Black wins)
- Popular continuations with result percentages
- Notable games featuring the position

### AI Move Explanations
- Claude-powered strategic and tactical analysis
- Explains the ideas behind top engine moves
- Requires an Anthropic API key (stored locally in browser)
- Optional Supabase caching to avoid redundant API calls

## Getting Started

### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/chess-playalong.git
   cd chess-playalong
   ```

2. Copy the example config file:
   ```bash
   cp config.example.js config.js
   ```

3. Open `index.html` in your browser, or serve it with any static file server:
   ```bash
   # Using Python
   python -m http.server 8000

   # Using Node.js
   npx serve .
   ```

4. Navigate to `http://localhost:8000` (or open the file directly)

### API Key Setup (Optional)

For AI-powered move explanations, you'll need an Anthropic API key:

1. Get an API key from [Anthropic Console](https://console.anthropic.com/)
2. When prompted in the app, enter your API key
3. The key is stored in your browser's localStorage

You can skip this step and use all other features without an API key.

### Supabase Caching (Optional)

To cache move explanations and reduce API calls, you can set up Supabase:

1. Create a free project at [Supabase](https://supabase.com/)

2. Create the `move_explanations` table using the SQL Editor:
   ```sql
   CREATE TABLE move_explanations (
       id SERIAL PRIMARY KEY,
       cache_key TEXT UNIQUE NOT NULL,
       fen TEXT NOT NULL,
       move TEXT NOT NULL,
       explanation TEXT NOT NULL,
       created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Enable Row Level Security
   ALTER TABLE move_explanations ENABLE ROW LEVEL SECURITY;

   -- Allow public read/write access
   CREATE POLICY "Allow public access" ON move_explanations
       FOR ALL USING (true) WITH CHECK (true);
   ```

3. Get your project URL and anon key from Project Settings > API

4. Add your credentials to `config.js`:
   ```javascript
   const CONFIG = {
       supabase: {
           url: 'https://your-project.supabase.co',
           anonKey: 'your-anon-key'
       },
       // ... other settings
   };
   ```

The app works without Supabase - explanations just won't be cached between sessions.

## Usage

### Making Moves
- Drag and drop pieces to make moves
- The engine will automatically analyze each position

### Analysis Panel
- **Candidate Moves**: Shows the top 4 engine recommendations with evaluations
- **Hover** over a candidate move to preview it on the board
- **Click** a candidate move to play it
- **Explain Moves**: Get AI analysis of all candidate moves (or enable Auto for automatic explanations)

### Opening Data
- When in book positions, see statistics from master-level games
- View win percentages and popular continuations
- Click on notable games for more context

### Position Controls
- **New Game**: Start a fresh game
- **Undo**: Take back the last move
- **Flip Board**: Switch perspective
- **FEN Input**: Load any position by pasting a FEN string

## Tech Stack

| Component | Technology |
|-----------|------------|
| UI Framework | Vanilla JavaScript |
| Chess Board | [Chessboard.js](https://chessboardjs.com/) v1.0.0 |
| Chess Logic | [Chess.js](https://github.com/jhlywa/chess.js) v0.10.3 |
| Engine | [Stockfish.js](https://github.com/nicm0/stockfish-web) v10.0.2 |
| DOM Manipulation | jQuery v3.7.1 |
| Opening Data | [Lichess Masters API](https://lichess.org/api#tag/Opening-Explorer) |
| AI Analysis | [Anthropic Claude API](https://docs.anthropic.com/) |
| Caching (Optional) | [Supabase](https://supabase.com/) |

## Architecture

The application is organized into separate files for maintainability. No build process is required.

```
chess-playalong/
├── index.html        # HTML structure and CSS styles
├── config.js         # Your configuration (gitignored)
├── config.example.js # Configuration template
├── app.js            # Application logic
├── README.md         # This file
└── .gitignore        # Git configuration
```

### Key Components

- **Board State**: Managed by Chess.js for move validation and game logic
- **Visual Board**: Rendered by Chessboard.js with custom dark theme
- **Engine Worker**: Stockfish runs in a Web Worker for non-blocking analysis
- **API Integration**: Fetches opening data and AI explanations asynchronously

## Browser Requirements

- Modern browser with ES6+ support
- Web Workers enabled
- localStorage enabled
- Network access for external APIs (Lichess, Anthropic)

Tested on Chrome, Firefox, Safari, and Edge.

## Configuration

All settings can be configured in `config.js`:

```javascript
const CONFIG = {
    // Supabase (optional - for caching explanations)
    supabase: {
        url: 'https://your-project.supabase.co',
        anonKey: 'your-anon-key'
    },

    // Anthropic API key (can also be set via the UI modal)
    anthropicApiKey: 'sk-ant-...',

    // Engine settings
    engine: {
        depth: 18,    // Analysis depth (higher = slower but more accurate)
        multiPV: 4    // Number of candidate moves to show
    },

    // Claude model for explanations
    claudeModel: 'claude-sonnet-4-5-20250929'
};
```

## Customization

### Board Colors
The board uses a custom dark theme. To modify colors, search for these CSS variables in `index.html`:

```css
.white-1e1d7 { background-color: #d4c4a8; }  /* Light squares */
.black-3c85d { background-color: #8b7355; }  /* Dark squares */
```

### Analysis Depth
To change the Stockfish analysis depth, modify this line:

```javascript
stockfish.postMessage('go depth 18');
```

### Number of Candidate Moves
To show more or fewer candidate moves, adjust MultiPV:

```javascript
stockfish.postMessage('setoption name MultiPV value 4');
```

## License

MIT License - feel free to use and modify as you see fit.

## Acknowledgments

- [Lichess](https://lichess.org/) for the excellent opening explorer API
- [Stockfish](https://stockfishchess.org/) team for the powerful chess engine
- [Chessboard.js](https://chessboardjs.com/) for the interactive board component
- [Anthropic](https://anthropic.com/) for Claude API access
- [Supabase](https://supabase.com/) for the optional caching backend
