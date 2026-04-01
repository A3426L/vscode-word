import * as vscode from 'vscode';
import { FlashcardProvider } from './FlashcardProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-flashcards" is now active!');

    const provider = new FlashcardProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(FlashcardProvider.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flashcards.loadCSV', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Open CSV',
                filters: {
                    'CSV Files': ['csv']
                }
            });

            if (uris && uris.length > 0) {
                const fileUri = uris[0];
                const fileData = await vscode.workspace.fs.readFile(fileUri);
                const csvContent = Buffer.from(fileData).toString('utf8');
                provider.loadCSV(csvContent);
                
                // Save the loaded file URI to workspace state for auto-loading
                context.workspaceState.update('lastLoadedCsvUri', fileUri.toString());
                
                // Also focus the view
                vscode.commands.executeCommand('flashcards-view.focus');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('flashcards.shuffle', () => {
            provider.shuffle();
        })
    );
}

export function deactivate() {}
