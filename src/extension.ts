import * as vscode from 'vscode';
import { Ollama } from 'ollama';

const BASE_PROMPT = 'You are a helpful code tutor. Your job is to teach the user with simple descriptions and sample code of the concept. Respond with a guided overview of the concept in a series of messages. Do not give the user the answer directly, but guide them to find the answer themselves. If the user asks a non-programming question, politely decline to respond.';

const EXERCISES_PROMPT = 'You are a helpful tutor. Your job is to teach the user with fun, simple exercises that they can complete in the editor. Your exercises should start simple and get more complex as the user progresses. Move one concept at a time, and do not move on to the next concept until the user provides the correct answer. Give hints in your exercises to help the user learn. If the user is stuck, you can provide the answer and explain why it is the answer. If the user asks a non-programming question, politely decline to respond.';

const MODEL_NAME = 'llama3.1:8b'; // A more commonly available model name

export function activate(context: vscode.ExtensionContext) {

	// Create Ollama client
	const ollama = new Ollama();

	// define a chat handler
	const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {

		// Check if Ollama is running
		try {
			// Check Ollama connection by getting the list of models
			await ollama.list();
		} catch (error) {
			console.error("Error connecting to Ollama:", error);
			stream.markdown(`
**Error:** Unable to connect to Ollama. 

Please make sure:
1. Ollama is installed on your system. If not, visit [ollama.ai](https://ollama.ai) to download and install it.
2. Ollama is running on http://localhost:11434.
3. The model "${MODEL_NAME}" is installed. You can install it by running \`ollama pull ${MODEL_NAME}\` in your terminal.

For more information, see the [Ollama documentation](https://github.com/ollama/ollama).
`);
			return;
		}

		// Check if the model exists
		try {
			const models = await ollama.list();
			const modelExists = models.models.some((model: { name: string }) => model.name === MODEL_NAME);
			
			if (!modelExists) {
				stream.markdown(`**Error:** The model "${MODEL_NAME}" is not available in Ollama. Please run \`ollama pull ${MODEL_NAME}\` in your terminal to download it.`);
				return;
			}
		} catch (error) {
			console.error("Error checking model availability:", error);
			stream.markdown("**Error:** Unable to check if the model is available. Please make sure Ollama is running correctly.");
			return;
		}

		// initialize the prompt
		let prompt = BASE_PROMPT;

		if (request.command === 'exercise') {
			prompt = EXERCISES_PROMPT;
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
				model: MODEL_NAME,
				messages: messages,
				stream: true,
				options: {
					temperature: 0.7
				}
			});

			// Process the streaming response
			for await (const chunk of response) {
				if (chunk.message?.content) {
					stream.markdown(chunk.message.content);
				}
			}
		} catch (error) {
			console.error("Error communicating with Ollama:", error);
			stream.markdown("**Error:** Unable to communicate with the local Ollama instance.");
		}

		return;

	};

	// create participant
	const tutor = vscode.chat.createChatParticipant("chat-tutorial.code-tutor", handler);
	
	// add icon to participant
	tutor.iconPath = vscode.Uri.joinPath(context.extensionUri, 'tutor.jpeg');
}

export function deactivate() { }
