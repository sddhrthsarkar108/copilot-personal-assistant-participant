import * as vscode from 'vscode';
import { BASE_PROMPT, DSA_COACH_PROMPT } from './prompts';

console.log('Extension module loaded - before activation');

// Default model to use if none is selected
const DEFAULT_MODEL = 'llama3.2:3b';

// Configuration for the extension
const CONFIG_SECTION = 'sidsAssistant';
const CONFIG_MODEL = 'selectedModel';

// Status bar item to show the current model
let modelStatusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
	console.log('Activating Sid\'s Assistant extension...');
	
	try {
		const { Ollama } = await import('ollama');

		const ollama = new Ollama();
		console.log('Ollama client created successfully');

		// Create status bar item immediately
		modelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		modelStatusBarItem.command = 'sids-assistant.refreshModels';
		modelStatusBarItem.tooltip = 'Click to change the Ollama model for Sid\'s Assistant';
		context.subscriptions.push(modelStatusBarItem);
		
		// Update and show status bar with default model value even before connecting to Ollama
		updateStatusBar();
		modelStatusBarItem.show();

		// Register a command to refresh and select models
		const refreshModelsCommand = vscode.commands.registerCommand('sids-assistant.refreshModels', async () => {
			try {
				await updateModelsListWithUI(ollama, context);
			} catch (error) {
				console.error('Error refreshing models:', error);
				vscode.window.showErrorMessage('Failed to refresh Ollama models. Make sure Ollama is running.');
				updateStatusBar();
			}
		});
		context.subscriptions.push(refreshModelsCommand);

		// Listen for configuration changes
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_MODEL}`)) {
				updateStatusBar();
			}
		}));

		// Initial models check - but don't show UI and don't wait for it to finish activation
		checkOllamaModels(ollama).catch(error => {
			console.log('Error during initial models check:', error);
		});

		// define a chat handler
		const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, _token: vscode.CancellationToken) => {
			console.log(`Handler called with prompt: "${request.prompt.substring(0, 50)}${request.prompt.length > 50 ? '...' : ''}"`);
			console.log(`Command: ${request.command || 'none'}`);

			// Check if Ollama is running
			try {
				console.log('Checking Ollama connection...');
				// Check Ollama connection by getting the list of models
				await ollama.list();
				console.log('Ollama connection successful');
			} catch (error) {
				console.error("Error connecting to Ollama:", error);
				console.log('Sending error message to user about Ollama connection');
				stream.markdown(`**Error:** Unable to connect to Ollama. `);
				return;
			}

			// Get the currently selected model
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			const selectedModel = config.get<string>(CONFIG_MODEL) || DEFAULT_MODEL;
			console.log(`Using selected model: ${selectedModel}`);

			// Check if the model exists
			try {
				const models = await ollama.list();
				
				const modelExists = models.models.some((model: { name: string }) => model.name === selectedModel);
				
				if (!modelExists) {
					stream.markdown(`**Error:** The model "${selectedModel}" is not available in Ollama. Please select a different model from the dropdown or run \`ollama pull ${selectedModel}\` in your terminal to download it.`);
					return;
				}
				console.log(`Model "${selectedModel}" found`);
			} catch (error) {
				console.error("Error checking model availability:", error);
				stream.markdown("**Error:** Unable to check if the model is available. Please make sure Ollama is running correctly.");
				return;
			}

			// initialize the prompt based on command
			let prompt = BASE_PROMPT;

			if (request.command === 'dsa_coach') {
				console.log('Using tutor prompt');
				prompt = DSA_COACH_PROMPT;
			} else {
				console.log('Using base prompt');
			}

			// initialize the messages array with the prompt
			const messages = [
				{ role: "system", content: prompt }
			];

			// get all the previous participant messages
			const previousMessages = context.history.filter(
				(h) => h instanceof vscode.ChatResponseTurn
			);

			// add the previous messages to the messages array
			previousMessages.forEach((m) => {
				let fullMessage = '';
				m.response.forEach((r) => {
					const mdPart = r as vscode.ChatResponseMarkdownPart;
					fullMessage += mdPart.value.value;
				});
				messages.push({ role: "assistant", content: fullMessage });
			});

			// add in the user's message
			messages.push({ role: "user", content: request.prompt });
			
			try {
				// Use the Ollama npm package to generate a streaming response
				const response = await ollama.chat({
					model: selectedModel,
					messages: messages,
					stream: true,
					options: {
						temperature: 0.7
					}
				});
				console.log('Got streaming response from Ollama');

				// Process the streaming response
				let chunkCount = 0;
				
				for await (const chunk of response) {
					chunkCount++;
					
					if (chunk.message?.content) {
						stream.markdown(chunk.message.content);
					} else {
						console.log(`CHUNK ${chunkCount} has no content`);
					}
				}
			} catch (error) {
				console.error("Error communicating with Ollama:", error);
				stream.markdown("**Error:** Unable to communicate with the local Ollama instance.");
			}

			console.log('Handler execution completed');
			return;
		};

		// create participant
		const assistant = vscode.chat.createChatParticipant("chat-tutorial.sids-assistant", handler);
		assistant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'dsa_coach.jpeg');
		console.log('Chat participant created successfully');
		console.log('Extension activation completed successfully');
	} catch (error) {
		console.error('CRITICAL ERROR during extension activation:', error);
		throw error;
	}
}

/**
 * Checks if Ollama is running and has models available, but doesn't show UI
 */
async function checkOllamaModels(ollama: any): Promise<void> {
	try {
		const modelsList = await ollama.list();
		
		if (!modelsList.models || modelsList.models.length === 0) {
			console.log('No Ollama models found. Will use default if needed.');
		} else {
			// Check if the currently selected model exists
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			const selectedModel = config.get<string>(CONFIG_MODEL) || DEFAULT_MODEL;
			const modelExists = modelsList.models.some((model: { name: string }) => model.name === selectedModel);
			
			if (!modelExists) {
				if (modelsList.models.length > 0) {
					const firstModelName = modelsList.models[0].name;
					console.log(`Setting first available model "${firstModelName}" as selected model`);
					await config.update(CONFIG_MODEL, firstModelName, vscode.ConfigurationTarget.Global);
				}
			} else {
				console.log(`Selected model "${selectedModel}" is available`);
			}
		}
		
		updateStatusBar();
	} catch (error) {
		console.error('Error checking Ollama models:', error);
		updateStatusBar();
	}
}

/**
 * Updates the list of available Ollama models and shows a quick pick to select one
 */
async function updateModelsListWithUI(ollama: any, _context: vscode.ExtensionContext) {
	try {
		// Get the list of models from Ollama
		const modelsList = await ollama.list();
		
		if (!modelsList.models || modelsList.models.length === 0) {
			vscode.window.showWarningMessage('No Ollama models found. Please install at least one model using the Ollama CLI.');
			// Still update the status bar
			updateStatusBar();
			return;
		}
		
		// Define the type for model items
		interface ModelQuickPickItem extends vscode.QuickPickItem {
			label: string;
			description: string;
		}
		
		// Create quick pick items from the models
		const modelItems: ModelQuickPickItem[] = modelsList.models.map((model: { name: string }) => ({
			label: model.name,
			description: 'Ollama model'
		}));
		
		// Show quick pick to select a model
		const selectedItem = await vscode.window.showQuickPick(modelItems, {
			placeHolder: 'Select an Ollama model to use with Sid\'s Assistant',
			title: 'Available Ollama Models'
		});
		
		if (selectedItem) {
			// Save the selected model to configuration
			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			await config.update(CONFIG_MODEL, selectedItem.label, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Sid's Assistant will now use the "${selectedItem.label}" model.`);
			
			// Update the status bar
			updateStatusBar();
		} else {
			// User cancelled the selection, still ensure status bar is updated
			updateStatusBar();
		}
	} catch (error) {
		console.error('Error updating models list:', error);
		vscode.window.showErrorMessage('Failed to fetch Ollama models. Make sure Ollama is running.');
		// Still update the status bar even if there was an error
		updateStatusBar();
	}
}

/**
 * Updates the status bar item with the currently selected model
 */
function updateStatusBar() {
	try {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const selectedModel = config.get<string>(CONFIG_MODEL) || DEFAULT_MODEL;
		modelStatusBarItem.text = `$(hubot) Sid's Assistant: ${selectedModel}`;
		modelStatusBarItem.show();
	} catch (error) {
		console.error('Error updating status bar:', error);
		// Provide a fallback in case of errors
		modelStatusBarItem.text = `$(hubot) Sid's Assistant: Select Model`;
		modelStatusBarItem.show();
	}
}

export function deactivate() {
	console.log('Sid\'s Assistant extension deactivated');
}
