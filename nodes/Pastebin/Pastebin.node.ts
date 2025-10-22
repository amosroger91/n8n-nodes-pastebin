import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import puppeteer from 'puppeteer';
import { exec } from 'child_process';

// Helper function to check for Puppeteer dependencies
async function checkPuppeteerDependencies(): Promise<string | null> {
    return new Promise((resolve) => {
        exec('./check_puppeteer_deps.sh', { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                resolve(`Puppeteer dependency check failed:\n${stdout}\n${stderr}`);
            } else {
                resolve(null);
            }
        });
    });
}

async function createPaste(url: string, content: string): Promise<string> {
	const browser = await puppeteer.launch({
		headless: true,
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage', // Overcomes limited resource problems
			'--disable-accelerated-2d-canvas', // Speeds up rendering
			'--no-first-run', // Skips initial setup
			'--no-zygote', // Prevents a crash on some systems
			'--single-process', // (Optional) if you're short on memory
			'--disable-gpu' // (Optional) if you're short on memory
		],
	});

	const page = await browser.newPage();

	await page.goto(url, {
		waitUntil: 'domcontentloaded',
		timeout: 60000,
	});

	await page.waitForSelector('textarea:not([style*="display: none"])');
	await page.type('textarea:not([style*="display: none"])', content);

	await page.evaluate(() => {
		const buttons = Array.from(document.querySelectorAll('button'));
		const sendButton = buttons.find(
			(button) => button.innerText.includes('Send') || button.innerText.includes('Create'),
		);

		if (sendButton) {
			sendButton.click();
		} else {
			throw new Error("'Send' or 'Create' button not found");
		}
	});

	await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

	const newUrl = page.url();

	await browser.close();

	return newUrl;
}

export class Pastebin implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Pastebin',
		name: 'pastebin',
		icon: { light: 'file:pastebin.svg', dark: 'file:pastebin.dark.svg' },
		group: ['output'],
		version: 1,
		description: 'Creates a paste on a pastebin instance and returns the link',
		defaults: {
			name: 'Pastebin',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Pastebin URL',
				name: 'pastebinUrl',
				type: 'string',
				default: '',
				placeholder: 'https://pastebin.com/',
				description: 'The URL of the pastebin instance',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				default: '',
				typeOptions: {
				
rows: 5,
				},
				placeholder: 'Enter content to paste...',
				description: 'The content to be pasted',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const dependencyError = await checkPuppeteerDependencies();
		if (dependencyError) {
			throw new NodeOperationError(this.getNode(), dependencyError);
		}

		let item: INodeExecutionData;
		let pastebinUrl: string;
		let content: string;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				pastebinUrl = this.getNodeParameter('pastebinUrl', itemIndex, '') as string;
				content = this.getNodeParameter('content', itemIndex, '') as string;
				item = items[itemIndex];

				const newUrl = await createPaste(pastebinUrl, content);
				item.json.pastebinLink = newUrl;

			} catch (error) {
				if (this.continueOnFail()) {
					items.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [items];
	}
}
