// ============================================
// State
// ============================================
let board = null;
let game = new Chess();
let boardFlipped = false;
let stockfish = null;
let currentAnalysis = [];
let apiKey = localStorage.getItem('anthropic_api_key') || (typeof CONFIG !== 'undefined' ? CONFIG.anthropicApiKey : '') || '';
let analysisTimeout = null;

// ============================================
// Supabase Configuration
// ============================================
let supabaseClient = null;

function initSupabase() {
    // Try config file first, then localStorage
    const url = (typeof CONFIG !== 'undefined' && CONFIG.supabase?.url) || localStorage.getItem('supabase_url') || '';
    const anonKey = (typeof CONFIG !== 'undefined' && CONFIG.supabase?.anonKey) || localStorage.getItem('supabase_anon_key') || '';

    if (url && anonKey && window.supabase) {
        supabaseClient = window.supabase.createClient(url, anonKey);
        console.log('Supabase cache enabled');
    }
}

// Generate cache key from position and move
function getCacheKey(fen, move) {
    // Use just the board position part of FEN (first part before space)
    // and the move for a unique key
    const boardPart = fen.split(' ')[0];
    return `${boardPart}_${move}`;
}

// Check cache for existing explanation
async function getExplanationFromCache(fen, move) {
    if (!supabaseClient) return null;

    try {
        const cacheKey = getCacheKey(fen, move);
        const { data, error } = await supabaseClient
            .from('move_explanations')
            .select('explanation')
            .eq('cache_key', cacheKey)
            .maybeSingle();

        if (error || !data) return null;
        return data.explanation;
    } catch (e) {
        // Silently handle cache errors - not critical
        return null;
    }
}

// Store explanation in cache
async function saveExplanationToCache(fen, move, explanation) {
    if (!supabaseClient) return;

    try {
        const cacheKey = getCacheKey(fen, move);
        await supabaseClient
            .from('move_explanations')
            .upsert({
                cache_key: cacheKey,
                fen: fen,
                move: move,
                explanation: explanation,
                created_at: new Date().toISOString()
            }, { onConflict: 'cache_key' });
    } catch (e) {
        // Silently handle cache errors - not critical
    }
}

// ============================================
// Initialize
// ============================================
function init() {
    initSupabase();
    initBoard();
    initStockfish();

    // Show API key modal if no key stored
    if (!apiKey) {
        document.getElementById('apiKeyModal').classList.add('active');
    }

    // Initial analysis
    analyzePosition();
}

function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDrop: handleMove,
        onDragStart: onDragStart
    };

    board = Chessboard('board', config);

    // Bind buttons
    document.getElementById('newGameBtn').addEventListener('click', newGame);
    document.getElementById('undoBtn').addEventListener('click', undoMove);
    document.getElementById('flipBtn').addEventListener('click', flipBoard);
    document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
    document.getElementById('skipApiKey').addEventListener('click', () => {
        document.getElementById('apiKeyModal').classList.remove('active');
    });
    document.getElementById('explainBtn').addEventListener('click', fetchExplanations);
    document.getElementById('copyFenBtn').addEventListener('click', copyFen);
    document.getElementById('setFenBtn').addEventListener('click', setFenFromInput);
    document.getElementById('fenInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setFenFromInput();
    });

    // Initialize FEN display
    updateFenDisplay();

    // Resize handling
    window.addEventListener('resize', () => board.resize());
}

async function initStockfish() {
    try {
        // Fetch Stockfish script and create a Blob URL to work around CORS restrictions
        const response = await fetch('https://unpkg.com/stockfish.js@10.0.2/stockfish.js');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        stockfish = new Worker(blobUrl);
        stockfish.onmessage = handleStockfishMessage;
        stockfish.postMessage('uci');

        const multiPV = (typeof CONFIG !== 'undefined' && CONFIG.engine?.multiPV) || 4;
        stockfish.postMessage(`setoption name MultiPV value ${multiPV}`);
        stockfish.postMessage('isready');
    } catch (e) {
        console.error('Failed to initialize Stockfish:', e);
        document.getElementById('engineDepth').textContent = 'Engine unavailable';
        document.getElementById('moveList').innerHTML = `
            <div class="empty-state">
                <p>Failed to load chess engine.</p>
                <p style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">
                    ${e.message}
                </p>
            </div>`;
    }
}

// ============================================
// Board interaction
// ============================================
function onDragStart(source, piece, position, orientation) {
    // Allow moving any piece (we're mirroring a game)
    // Use game_over() for chess.js 0.10.x compatibility
    if (game.game_over()) return false;
    return true;
}

function handleMove(source, target) {
    // Try the move
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Auto-promote to queen for now
    });

    if (move === null) return 'snapback';

    // Sync board with game state (needed for castling, en passant)
    board.position(game.fen());

    updateDisplay();
    analyzePosition();
}

function newGame() {
    game.reset();
    board.start();
    updateDisplay();
    analyzePosition();
}

function undoMove() {
    game.undo();
    board.position(game.fen());
    updateDisplay();
    analyzePosition();
}

function flipBoard() {
    boardFlipped = !boardFlipped;
    board.flip();
}

function copyFen() {
    const fen = game.fen();
    navigator.clipboard.writeText(fen).then(() => {
        const btn = document.getElementById('copyFenBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
    });
}

function setFenFromInput() {
    const fenInput = document.getElementById('fenInput');
    const fen = fenInput.value.trim();
    if (!fen) return;

    try {
        const valid = game.load(fen);
        if (valid) {
            board.position(fen);
            fenInput.value = '';
            updateDisplay();
            updateFenDisplay();
            analyzePosition();
        } else {
            alert('Invalid FEN position');
        }
    } catch (e) {
        alert('Invalid FEN format');
    }
}

function updateFenDisplay() {
    document.getElementById('fenDisplay').value = game.fen();
}

// ============================================
// Display updates
// ============================================
function updateDisplay() {
    // Turn indicator
    const isWhite = game.turn() === 'w';
    document.getElementById('turnDot').className = 'turn-dot' + (isWhite ? '' : ' black');
    document.getElementById('turnText').textContent = isWhite ? 'White to move' : 'Black to move';

    // Move count
    const fullMoves = Math.floor(game.history().length / 2) + 1;
    document.getElementById('moveCount').textContent = `Move ${fullMoves}`;

    // FEN display
    updateFenDisplay();

    // Move history
    updateMoveHistory();
}

function updateMoveHistory() {
    const history = game.history();
    const container = document.getElementById('moveHistory');

    if (history.length === 0) {
        container.innerHTML = '<div class="empty-state">No moves yet</div>';
        return;
    }

    let html = '';
    for (let i = 0; i < history.length; i += 2) {
        const moveNum = Math.floor(i / 2) + 1;
        const whiteMove = history[i];
        const blackMove = history[i + 1] || '';

        html += `<div class="move-pair">
            <span class="move-number">${moveNum}.</span>
            <span class="move-white">${whiteMove}</span>
            ${blackMove ? `<span class="move-black">${blackMove}</span>` : ''}
        </div>`;
    }

    container.innerHTML = html;
}

// ============================================
// Stockfish Analysis
// ============================================
let analysisLines = {};
let currentDepth = 0;

function analyzePosition() {
    // Clear previous analysis
    analysisLines = {};
    currentDepth = 0;
    document.getElementById('engineDepth').textContent = 'Analyzing...';
    document.getElementById('moveList').innerHTML = '<div class="empty-state">Analyzing position...</div>';

    // Debounce analysis
    if (analysisTimeout) clearTimeout(analysisTimeout);

    analysisTimeout = setTimeout(() => {
        if (stockfish) {
            stockfish.postMessage('stop');
            stockfish.postMessage(`position fen ${game.fen()}`);
            const depth = (typeof CONFIG !== 'undefined' && CONFIG.engine?.depth) || 18;
            stockfish.postMessage(`go depth ${depth}`);
        }

        // Also fetch opening book data
        fetchOpeningData();
    }, 100);
}

function handleStockfishMessage(event) {
    const line = event.data;

    if (line.startsWith('info depth')) {
        parseAnalysisLine(line);
    } else if (line.startsWith('bestmove')) {
        finalizeAnalysis();
    }
}

function parseAnalysisLine(line) {
    const depthMatch = line.match(/depth (\d+)/);
    const multipvMatch = line.match(/multipv (\d+)/);
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)/);

    if (!depthMatch || !multipvMatch || !scoreMatch || !pvMatch) return;

    const depth = parseInt(depthMatch[1]);
    const multipv = parseInt(multipvMatch[1]);
    const scoreType = scoreMatch[1];
    const scoreValue = parseInt(scoreMatch[2]);
    const pv = pvMatch[1].split(' ');

    // Only update if this is a new depth for this line
    if (depth >= currentDepth) {
        currentDepth = depth;

        // Convert UCI move to SAN
        const tempGame = new Chess(game.fen());
        const uciMove = pv[0];
        const from = uciMove.substring(0, 2);
        const to = uciMove.substring(2, 4);
        const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

        const move = tempGame.move({ from, to, promotion });
        if (!move) return;

        // Calculate eval from current player's perspective
        let evalScore;
        if (scoreType === 'mate') {
            evalScore = scoreValue > 0 ? `M${scoreValue}` : `M${scoreValue}`;
        } else {
            // Stockfish gives score from white's perspective
            const cpScore = game.turn() === 'w' ? scoreValue : -scoreValue;
            evalScore = (cpScore / 100).toFixed(2);
            if (cpScore > 0) evalScore = '+' + evalScore;
        }

        analysisLines[multipv] = {
            move: move.san,
            uci: uciMove,
            eval: evalScore,
            depth: depth,
            pv: pv
        };

        // Update display at certain depths
        if (depth >= 10 && depth % 2 === 0) {
            updateAnalysisDisplay();
        }
    }
}

function finalizeAnalysis() {
    updateAnalysisDisplay();

    // Auto-explain if checkbox is checked
    const autoExplain = document.getElementById('autoExplainCheckbox').checked;
    if (autoExplain && apiKey && currentAnalysis.length > 0) {
        fetchExplanations();
    }
}

function updateEvalDisplay(evalStr) {
    const scoreEl = document.getElementById('evalScore');
    const barEl = document.getElementById('winProbWhite');

    scoreEl.textContent = evalStr;

    // Convert eval to win probability
    let winProb = 50;
    if (evalStr.startsWith('M')) {
        const mateIn = parseInt(evalStr.substring(1));
        winProb = mateIn > 0 ? 100 : 0;
    } else {
        const cp = parseFloat(evalStr) * 100;
        // Using Lichess formula: winProb = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
        winProb = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
    }

    barEl.style.width = `${winProb}%`;

    // Color the score based on advantage
    if (winProb > 55) {
        scoreEl.style.color = 'var(--text-primary)';
    } else if (winProb < 45) {
        scoreEl.style.color = 'var(--text-muted)';
    } else {
        scoreEl.style.color = 'var(--text-secondary)';
    }
}

function updateAnalysisDisplay() {
    document.getElementById('engineDepth').textContent = `Depth ${currentDepth}`;

    const moves = Object.values(analysisLines).sort((a, b) => {
        // Sort by eval (best first)
        const evalA = parseEval(a.eval);
        const evalB = parseEval(b.eval);
        return evalB - evalA;
    });

    if (moves.length === 0) {
        document.getElementById('moveList').innerHTML = '<div class="empty-state">No legal moves</div>';
        return;
    }

    currentAnalysis = moves;

    // Update the eval bar with best move's eval
    if (moves.length > 0) {
        updateEvalDisplay(moves[0].eval);
    }

    let html = '';
    moves.forEach((m, i) => {
        const evalClass = getEvalClass(m.eval);
        const isBest = i === 0;

        html += `<div class="move-item${isBest ? ' best' : ''}" data-move="${m.uci}">
            <span class="move-rank">#${i + 1}</span>
            <div>
                <div class="move-notation">${m.move}</div>
                <div class="move-eval ${evalClass}">${m.eval}</div>
            </div>
            <div class="move-explanation" id="explanation-${i}">
                ${!apiKey ? 'Add API key for explanations' : 'Click "Explain Moves" for analysis'}
            </div>
        </div>`;
    });

    document.getElementById('moveList').innerHTML = html;

    // Add hover and click handlers
    document.querySelectorAll('.move-item').forEach(el => {
        el.addEventListener('mouseenter', () => {
            const uci = el.dataset.move;
            previewMove(uci);
        });
        el.addEventListener('mouseleave', clearPreview);
        el.addEventListener('click', () => {
            const uci = el.dataset.move;
            playAnalysisMove(uci);
        });
    });
}

function playAnalysisMove(uci) {
    // Clear any preview state first
    clearPreview();

    // Parse UCI move
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;

    // Make the move
    const move = game.move({ from, to, promotion });
    if (!move) return;

    // Update board and display
    board.position(game.fen());
    updateDisplay();
    analyzePosition();
}

function parseEval(evalStr) {
    if (evalStr.startsWith('M')) {
        const mateIn = parseInt(evalStr.substring(1));
        return mateIn > 0 ? 10000 - mateIn : -10000 - mateIn;
    }
    return parseFloat(evalStr);
}

function getEvalClass(evalStr) {
    if (evalStr.startsWith('M')) {
        return parseInt(evalStr.substring(1)) > 0 ? 'positive' : 'negative';
    }
    const val = parseFloat(evalStr);
    if (val > 0.3) return 'positive';
    if (val < -0.3) return 'negative';
    return 'neutral';
}

let previewPosition = null;

function previewMove(uci) {
    // Store current position if not already previewing
    if (!previewPosition) {
        previewPosition = game.fen();
    }

    // Create a temp game to make the move
    const tempGame = new Chess(previewPosition);
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;

    const move = tempGame.move({ from, to, promotion });
    if (move) {
        board.position(tempGame.fen(), false);
    }

    // Highlight squares
    document.querySelectorAll('.square-55d63').forEach(sq => {
        sq.style.boxShadow = '';
    });

    const fromSq = document.querySelector(`.square-${from}`);
    const toSq = document.querySelector(`.square-${to}`);

    if (fromSq) fromSq.style.boxShadow = 'inset 0 0 0 4px rgba(212, 160, 60, 0.6)';
    if (toSq) toSq.style.boxShadow = 'inset 0 0 0 4px rgba(212, 160, 60, 0.6)';
}

function clearPreview() {
    if (previewPosition) {
        board.position(previewPosition, false);
        previewPosition = null;
    }

    // Clear highlights
    document.querySelectorAll('.square-55d63').forEach(sq => {
        sq.style.boxShadow = '';
    });
}

// ============================================
// Opening Book
// ============================================
async function fetchOpeningData() {
    const fen = game.fen();

    try {
        // Lichess masters database
        const response = await fetch(`https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}`);
        const data = await response.json();

        updateOpeningDisplay(data);
    } catch (e) {
        console.error('Opening fetch error:', e);
        document.getElementById('openingContent').innerHTML = `
            <div class="opening-name">Unknown Position</div>
            <div class="opening-eco">Not in opening book</div>
        `;
    }
}

function updateOpeningDisplay(data) {
    const content = document.getElementById('openingContent');

    if (!data.opening && data.moves.length === 0) {
        content.innerHTML = `
            <div class="opening-name">Out of Book</div>
            <div class="opening-eco">Position not in masters database</div>
        `;
        return;
    }

    const opening = data.opening || { name: 'Starting Position', eco: '' };
    const total = data.white + data.draws + data.black || 1;
    const whitePercent = ((data.white / total) * 100).toFixed(1);
    const drawPercent = ((data.draws / total) * 100).toFixed(1);
    const blackPercent = ((data.black / total) * 100).toFixed(1);

    // Build book moves HTML
    let bookMovesHtml = '';
    if (data.moves && data.moves.length > 0) {
        const topMoves = data.moves.slice(0, 5);
        bookMovesHtml = `
            <div class="book-moves-title">Popular Continuations</div>
            <div class="book-moves">
                ${topMoves.map(m => {
                    const mTotal = m.white + m.draws + m.black || 1;
                    const mWhite = (m.white / mTotal) * 100;
                    const mDraw = (m.draws / mTotal) * 100;
                    const mBlack = (m.black / mTotal) * 100;
                    const openingName = m.opening ? m.opening.name : '';
                    return `
                        <div class="book-move">
                            <span class="book-move-san">${m.san}</span>
                            <span class="book-move-opening" title="${openingName}">${openingName || '—'}</span>
                            <div class="book-move-bar" title="White: ${mWhite.toFixed(0)}% Draw: ${mDraw.toFixed(0)}% Black: ${mBlack.toFixed(0)}%">
                                <div class="bar-white" style="width: ${mWhite}%"></div>
                                <div class="bar-draw" style="width: ${mDraw}%"></div>
                                <div class="bar-black" style="width: ${mBlack}%"></div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // Build top games HTML
    let topGamesHtml = '';
    if (data.topGames && data.topGames.length > 0) {
        const games = data.topGames.slice(0, 3);
        topGamesHtml = `
            <div class="top-games-title">Notable Games</div>
            ${games.map(g => {
                const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½';
                return `
                    <div class="top-game">
                        <span class="top-game-players">${g.white.name} vs ${g.black.name}</span>
                        <span class="top-game-result">${result}</span>
                        <span class="top-game-year">${g.year}</span>
                    </div>
                `;
            }).join('')}
        `;
    }

    content.innerHTML = `
        <div class="opening-name">${opening.name || 'Starting Position'}</div>
        <div class="opening-eco">${opening.eco || ''}</div>
        <div class="opening-stats">
            <div class="stat">
                <span class="stat-label">Games</span>
                <span class="stat-value">${total.toLocaleString()}</span>
            </div>
            <div class="stat">
                <span class="stat-label">White wins</span>
                <span class="stat-value white">${whitePercent}%</span>
            </div>
            <div class="stat">
                <span class="stat-label">Draws</span>
                <span class="stat-value draw">${drawPercent}%</span>
            </div>
            <div class="stat">
                <span class="stat-label">Black wins</span>
                <span class="stat-value black">${blackPercent}%</span>
            </div>
        </div>
        ${bookMovesHtml}
        ${topGamesHtml}
    `;
}

// ============================================
// Claude Explanations
// ============================================
async function fetchExplanations() {
    if (!apiKey) {
        document.getElementById('apiKeyModal').classList.add('active');
        return;
    }
    if (currentAnalysis.length === 0) return;

    // Show loading state
    const btn = document.getElementById('explainBtn');
    btn.disabled = true;
    btn.textContent = 'Explaining...';

    const fen = game.fen();
    const turn = game.turn() === 'w' ? 'White' : 'Black';
    const movesToExplain = currentAnalysis.slice(0, 4);

    // Check cache for each move
    const cachedExplanations = {};
    const uncachedMoves = [];

    for (const m of movesToExplain) {
        const el = document.getElementById(`explanation-${movesToExplain.indexOf(m)}`);
        if (el) {
            el.classList.add('loading');
            el.textContent = 'Checking cache...';
        }

        const cached = await getExplanationFromCache(fen, m.move);
        if (cached) {
            cachedExplanations[m.move] = cached;
            if (el) {
                el.classList.remove('loading');
                el.textContent = cached;
            }
        } else {
            uncachedMoves.push(m);
            if (el) {
                el.textContent = 'Generating explanation...';
            }
        }
    }

    // If all moves were cached, we're done
    if (uncachedMoves.length === 0) {
        btn.disabled = false;
        btn.textContent = 'Explain Moves';
        return;
    }

    // Build prompt for uncached moves only
    const movesStr = uncachedMoves.map(m => `${m.move} (eval: ${m.eval})`).join(', ');

    const prompt = `You are a chess coach. Analyze this position and explain each candidate move concisely.

Position (FEN): ${fen}
${turn} to move.

Top engine moves: ${movesStr}

For each move, give a 1-2 sentence explanation of the strategic or tactical idea. Focus on:
- What the move accomplishes
- Any threats created or prevented
- Positional considerations

Format your response as:
MOVE: explanation
MOVE: explanation
...

Be concise and insightful, like a strong club player explaining to an improving student.`;

    try {
        const model = (typeof CONFIG !== 'undefined' && CONFIG.claudeModel) || 'claude-sonnet-4-5-20250929';
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.content[0].text;

        // Parse explanations
        const newExplanations = parseExplanations(text);

        // Save new explanations to cache and update display
        for (const m of uncachedMoves) {
            const explanation = newExplanations[m.move];
            if (explanation) {
                // Save to cache (async, don't wait)
                saveExplanationToCache(fen, m.move, explanation);
            }
        }

        // Merge cached and new explanations
        const allExplanations = { ...cachedExplanations, ...newExplanations };

        // Update display
        movesToExplain.forEach((m, i) => {
            const el = document.getElementById(`explanation-${i}`);
            if (el) {
                el.classList.remove('loading');
                el.textContent = allExplanations[m.move] || 'No explanation available';
            }
        });

    } catch (e) {
        console.error('Claude API error:', e);
        movesToExplain.forEach((m, i) => {
            const el = document.getElementById(`explanation-${i}`);
            if (el && !cachedExplanations[m.move]) {
                el.classList.remove('loading');
                el.textContent = 'Error fetching explanation';
            }
        });
    } finally {
        // Reset button state
        btn.disabled = false;
        btn.textContent = 'Explain Moves';
    }
}

function parseExplanations(text) {
    const explanations = {};
    const lines = text.split('\n');

    for (const line of lines) {
        // Match patterns like "e4: explanation" or "1. e4: explanation" or "**e4**: explanation"
        const match = line.match(/^\*?\*?(\d+\.\s*)?([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\*?\*?[:\s]+(.+)/);
        if (match) {
            const move = match[2];
            const explanation = match[3].trim();
            explanations[move] = explanation;
        }
    }

    return explanations;
}

// ============================================
// API Key management
// ============================================
function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    apiKey = input.value.trim();

    if (apiKey) {
        localStorage.setItem('anthropic_api_key', apiKey);
        document.getElementById('apiKeyModal').classList.remove('active');

        // Re-fetch explanations
        if (currentAnalysis.length > 0) {
            fetchExplanations();
        }
    }
}

// ============================================
// Start
// ============================================
document.addEventListener('DOMContentLoaded', init);
