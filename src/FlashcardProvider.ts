import * as vscode from 'vscode';

export class FlashcardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flashcards-view';
    private _view?: vscode.WebviewView;
    private _currentIndex: number = 0;
    private _currentQuestion: string = '';
    private _currentOrder: string[] = [];
    private _currentFileUri?: vscode.Uri;

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'requestLoad':
                    {
                        vscode.commands.executeCommand('flashcards.loadCSV');
                        break;
                    }
                case 'updateIndex':
                    {
                        this._currentIndex = data.index;
                        this._currentQuestion = data.question;
                        break;
                    }
                case 'updateOrder':
                    {
                        this._currentOrder = data.order;
                        break;
                    }
            }
        });

        const lastLoadedUriStr = this._context.workspaceState.get<string>('lastLoadedCsvUri');
        if (lastLoadedUriStr) {
            try {
                const fileUri = vscode.Uri.parse(lastLoadedUriStr);
                vscode.workspace.fs.readFile(fileUri).then(
                    fileData => {
                        const csvContent = Buffer.from(fileData).toString('utf8');
                        const bookmarkedIndex = this._context.workspaceState.get<number>(`bookmark_${fileUri.toString()}`) || 0;
                        const bookmarkedQuestion = this._context.workspaceState.get<string>(`bookmark_q_${fileUri.toString()}`);
                        const savedOrder = this._context.workspaceState.get<string[]>(`bookmark_order_${fileUri.toString()}`);
                        this.loadCSV(csvContent, fileUri, bookmarkedIndex, bookmarkedQuestion, savedOrder);
                    },
                    _error => {
                        // File might have been deleted, clean up state
                        this._context.workspaceState.update('lastLoadedCsvUri', undefined);
                    }
                );
            } catch (e) {
                // Ignore parsing errors
            }
        }
    }

    public async loadCSV(csvContent: string, fileUri?: vscode.Uri, startIndex: number = 0, targetQuestion?: string, savedOrder?: string[]) {
        if (this._view) {
            this._view.show?.(true);
            this._currentFileUri = fileUri;
            this._currentIndex = startIndex;
            // Simple CSV parser
            const rawCards = [];
            const lines = csvContent.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                // Skip empty lines
                if (!line) continue;
                
                // Assuming "Question,Answer" format or "Question","Answer"
                // Very basic split by comma, ignoring commas inside quotes
                const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
                let matches = [];
                let match;
                while ((match = regex.exec(line)) !== null) {
                    matches.push(match[1].replace(/^"(.*)"$/, '$1'));
                }
                
                // If regex completely fails on simple "Q,A", fallback to split
                if (matches.length < 2) {
                    matches = line.split(',').map(m => m.trim());
                }

                if (matches.length >= 2) {
                    // Always skip the first row as it's typically a header (column names)
                    if (i === 0) {
                        continue;
                    }
                    rawCards.push({ question: matches[0], answer: matches[1] });
                }
            }

            const cards = [...rawCards];

            // Reorder based on savedOrder if provided
            if (savedOrder && savedOrder.length > 0) {
                const cardMap = new Map(cards.map(c => [c.question, c]));
                const reorderedCards = [];
                const seenQuestions = new Set();

                // Fill from saved order
                for (const q of savedOrder) {
                    const card = cardMap.get(q);
                    if (card) {
                        reorderedCards.push(card);
                        seenQuestions.add(q);
                    }
                }

                // Append any new cards that weren't in the saved order
                for (const card of cards) {
                    if (!seenQuestions.has(card.question)) {
                        reorderedCards.push(card);
                    }
                }

                if (reorderedCards.length > 0) {
                    cards.length = 0;
                    cards.push(...reorderedCards);
                }
            }

            this._currentOrder = cards.map(c => c.question);

            let finalStartIndex = startIndex;
            if (targetQuestion) {
                const foundIndex = cards.findIndex(c => c.question === targetQuestion);
                if (foundIndex !== -1) {
                    finalStartIndex = foundIndex;
                }
            }

            this._currentIndex = finalStartIndex;
            if (cards.length > finalStartIndex) {
                this._currentQuestion = cards[finalStartIndex].question;
            }

            this._view.webview.postMessage({ 
                type: 'loadCards', 
                cards: cards,
                originalCards: rawCards,
                startIndex: finalStartIndex
            });
        }
    }

    public bookmarkCurrent() {
        if (!this._currentFileUri) {
            vscode.window.showWarningMessage('No CSV file loaded.');
            return;
        }

        this._context.workspaceState.update(`bookmark_${this._currentFileUri.toString()}`, this._currentIndex);
        this._context.workspaceState.update(`bookmark_q_${this._currentFileUri.toString()}`, this._currentQuestion);
        this._context.workspaceState.update(`bookmark_order_${this._currentFileUri.toString()}`, this._currentOrder);
        vscode.window.showInformationMessage(`Bookmarked: ${this._currentQuestion}`);
    }

    public shuffle() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'shuffle' });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Flashcards</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 10px;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        height: 100vh;
                        box-sizing: border-box;
                        margin: 0;
                        overflow: hidden;
                    }

                    .controls {
                        display: flex;
                        gap: 10px;
                        margin-bottom: 20px;
                        width: 100%;
                        justify-content: space-between;
                        align-items: center;
                    }

                    button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 6px 16px;
                        cursor: pointer;
                        border-radius: 20px;
                    }

                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }

                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }

                    /* Flashcard Scene */
                    .scene {
                        width: 100%;
                        max-width: 300px;
                        height: 200px;
                        perspective: 600px;
                        margin-bottom: 20px;
                        flex-shrink: 0;
                    }

                    .card {
                        width: 100%;
                        height: 100%;
                        position: relative;
                        transition: transform 0.6s;
                        transform-style: preserve-3d;
                        cursor: pointer;
                    }

                    .card.is-flipped {
                        transform: rotateY(180deg);
                    }

                    .card__face {
                        position: absolute;
                        width: 100%;
                        height: 100%;
                        -webkit-backface-visibility: hidden;
                        backface-visibility: hidden;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-family: var(--vscode-font-family);
                        font-weight: bold;
                        border-radius: 8px;
                        padding: 15px;
                        box-sizing: border-box;
                        text-align: center;
                        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        border: 1px solid var(--vscode-panel-border);
                    }

                    .card-text {
                        display: -webkit-box;
                        -webkit-line-clamp: 6; /* Maximum lines before ellipsis */
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        word-break: break-all;
                        width: 100%;
                        font-size: 1.2rem; /* Adjusted for longer text */
                        line-height: 1.4;
                    }

                    .card__face--back {
                        transform: rotateY(180deg);
                        background: var(--vscode-editor-inactiveSelectionBackground);
                    }

                    #empty-state {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        text-align: center;
                    }

                    #flashcard-container {
                        display: none;
                        flex-direction: column;
                        align-items: center;
                        width: 100%;
                    }

                    .status {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }

                    }
                </style>
            </head>
            <body>
                <div id="empty-state">
                    <p>Load a CSV file to start learning!</p>
                    <button id="btn-load-empty">Select CSV</button>
                    <p class="status" style="margin-top: 20px;">Format: Question, Answer</p>
                </div>

                <div id="flashcard-container">
                    <div class="controls">
                        <button id="btn-prev">&laquo; Prev</button>
                        <span id="card-counter" class="status">0 / 0</span>
                        <button id="btn-next">Next &raquo;</button>
                    </div>

                    <div class="scene">
                        <div class="card" id="flashcard">
                            <div class="card__face card__face--front" id="card-front"></div>
                            <div class="card__face card__face--back" id="card-back"></div>
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    let cards = [];
                    let originalCards = [];
                    let isShuffled = false;
                    let currentIndex = 0;

                    const cardElement = document.getElementById('flashcard');
                    const frontElement = document.getElementById('card-front');
                    const backElement = document.getElementById('card-back');
                    const btnPrev = document.getElementById('btn-prev');
                    const btnNext = document.getElementById('btn-next');
                    const counterElement = document.getElementById('card-counter');
                    const emptyState = document.getElementById('empty-state');
                    const flashcardContainer = document.getElementById('flashcard-container');

                    // Flip function
                    cardElement.addEventListener('click', () => {
                        cardElement.classList.toggle('is-flipped');
                    });

                    // Navigation
                    btnPrev.addEventListener('click', () => {
                        if (currentIndex > 0) {
                            currentIndex--;
                            updateCard();
                        }
                    });

                    btnNext.addEventListener('click', () => {
                        if (currentIndex < cards.length - 1) {
                            currentIndex++;
                            updateCard();
                        }
                    });

                    // Request CSV from extension
                    document.getElementById('btn-load-empty').addEventListener('click', () => {
                        vscode.postMessage({ type: 'requestLoad' });
                    });

                    function updateCard() {
                        if (cards.length === 0) return;
                        
                        // Notify extension about current index and question
                        const currentCard = cards[currentIndex];
                        vscode.postMessage({ 
                            type: 'updateIndex', 
                            index: currentIndex,
                            question: currentCard ? currentCard.question : ''
                        });

                        // Force unflip
                        cardElement.classList.remove('is-flipped');
                        
                        setTimeout(() => {
                            frontElement.innerHTML = \`<div class="card-text">\${cards[currentIndex].question}</div>\`;
                            backElement.innerHTML = \`<div class="card-text">\${cards[currentIndex].answer}</div>\`;
                            counterElement.textContent = \`\${currentIndex + 1} / \${cards.length}\`;
                            
                            btnPrev.disabled = currentIndex === 0;
                            btnNext.disabled = currentIndex === cards.length - 1;
                        }, 150); // Small timeout to allow unflip animation to start before content changes
                    }

                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'loadCards':
                                cards = message.cards;
                                originalCards = message.originalCards;
                                // Determine if we are starting shuffled (if cards length > 0 and doesn't match original order)
                                isShuffled = cards.some((c, i) => originalCards[i] && c.question !== originalCards[i].question);

                                if (cards.length > 0) {
                                    currentIndex = (message.startIndex !== undefined && message.startIndex < cards.length) 
                                        ? message.startIndex 
                                        : 0;
                                    emptyState.style.display = 'none';
                                    flashcardContainer.style.display = 'flex';
                                    updateCard();
                                    
                                    // Report initial/loaded order
                                    vscode.postMessage({ type: 'updateOrder', order: cards.map(c => c.question) });
                                }
                                break;
                            case 'shuffle':
                                if (cards.length > 0) {
                                    if (isShuffled) {
                                        // Reset to original
                                        cards = [...originalCards];
                                        isShuffled = false;
                                    } else {
                                        // Perform shuffle
                                        for (let i = cards.length - 1; i > 0; i--) {
                                            const j = Math.floor(Math.random() * (i + 1));
                                            [cards[i], cards[j]] = [cards[j], cards[i]];
                                        }
                                        isShuffled = true;
                                    }
                                    currentIndex = 0;
                                    updateCard();
                                    
                                    // Report new shuffled order
                                    vscode.postMessage({ type: 'updateOrder', order: cards.map(c => c.question) });
                                }
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}
