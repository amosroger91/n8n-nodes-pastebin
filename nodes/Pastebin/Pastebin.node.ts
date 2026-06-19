import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

/*
 * ============================================================================
 *  PrivateBin v2 client — written FOR THIS OPEN-SOURCE PROJECT ONLY.
 * ============================================================================
 *
 *  This is a from-scratch, dependency-free reimplementation of the PrivateBin
 *  v2 "create paste" protocol, built specifically for the open-source
 *  `n8n-nodes-pastebin` community node (https://github.com/amosroger91/n8n-nodes-pastebin).
 *
 *  It encrypts the paste entirely client-side and uploads only ciphertext, so
 *  the PrivateBin server never sees the plaintext. The decryption key lives in
 *  the URL fragment (after the `#`) and is never sent to the server.
 *
 *  Protocol implemented (matches PrivateBin's reference web client):
 *    - 256-bit random paste key  -> Base58-encoded into the URL fragment
 *    - PBKDF2-HMAC-SHA256, 100,000 iterations, 64-bit salt -> AES key
 *    - AES-256-GCM encryption, 96-bit nonce, 128-bit auth tag
 *    - Raw DEFLATE compression of the paste payload
 *    - `adata` (the encryption spec) is used as GCM additional authenticated data
 *
 *  This implementation is provided for use within this project. It is not an
 *  official PrivateBin library and carries no affiliation with the PrivateBin
 *  project.
 * ============================================================================
 */

// Bitcoin Base58 alphabet — used by PrivateBin to encode the key in the URL fragment.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Buffer): string {
	// Big-endian interpretation of the byte array as a single integer.
	let value = 0n;
	for (const byte of bytes) {
		value = value * 256n + BigInt(byte);
	}

	let encoded = '';
	while (value > 0n) {
		const remainder = Number(value % 58n);
		value = value / 58n;
		encoded = BASE58_ALPHABET[remainder] + encoded;
	}

	// Preserve leading zero bytes as leading '1' characters.
	for (const byte of bytes) {
		if (byte === 0) {
			encoded = '1' + encoded;
		} else {
			break;
		}
	}

	return encoded;
}

interface PrivateBinResult {
	url: string;
	pasteId: string;
	deleteToken: string;
}

// Hosts for which plain HTTP is tolerated (local PrivateBin instances / testing).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function resolveBaseUrl(baseUrlRaw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(baseUrlRaw);
	} catch {
		throw new Error(`Invalid Pastebin URL: "${baseUrlRaw}". Expected something like https://privatebin.example.com/`);
	}

	// The shareable link (key in the fragment) is meant for the open internet, so the
	// upload channel itself must be authenticated. Reject plain HTTP except on localhost.
	if (parsed.protocol !== 'https:' && !LOCAL_HOSTS.has(parsed.hostname)) {
		throw new Error(
			`Pastebin URL must use HTTPS (got "${parsed.protocol}//"). Plain HTTP would let the network tamper with the paste. ` +
				'Use an https:// URL (http:// is only allowed for localhost).',
		);
	}

	return baseUrlRaw.replace(/\/+$/, '');
}

async function createPaste(
	context: IExecuteFunctions,
	baseUrlRaw: string,
	secret: string,
	expire: string,
	burnAfterReading: boolean,
	formatter: string,
): Promise<PrivateBinResult> {
	const baseUrl = resolveBaseUrl(baseUrlRaw);

	// --- Cryptographic material ----------------------------------------------
	const pasteKey = randomBytes(32); // 256-bit key, shared via the URL fragment
	const iv = randomBytes(12); // 96-bit GCM nonce
	const salt = randomBytes(8); // 64-bit PBKDF2 salt

	// Derive the AES key from the paste key (PBKDF2-HMAC-SHA256, 100k iterations).
	const derivedKey = pbkdf2Sync(pasteKey, salt, 100000, 32, 'sha256');

	// --- Build and compress the paste payload --------------------------------
	const pasteDataJson = JSON.stringify({ paste: secret });
	const compressed = deflateRawSync(Buffer.from(pasteDataJson, 'utf8'));

	try {
		// --- adata: the encryption spec, also used as GCM additional auth data ----
		// Layout: [[iv, salt, iterations, keySize, tagSize, "aes", "gcm", "zlib"],
		//          formatter, openDiscussion, burnAfterReading]
		const adata = [
			[iv.toString('base64'), salt.toString('base64'), 100000, 256, 128, 'aes', 'gcm', 'zlib'],
			formatter,
			0,
			burnAfterReading ? 1 : 0,
		];
		const adataString = JSON.stringify(adata);

		// --- Encrypt (AES-256-GCM) -------------------------------------------
		const cipher = createCipheriv('aes-256-gcm', derivedKey, iv, { authTagLength: 16 });
		cipher.setAAD(Buffer.from(adataString, 'utf8'));
		const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
		const authTag = cipher.getAuthTag();
		// PrivateBin stores ciphertext and tag concatenated, base64-encoded.
		const ct = Buffer.concat([ciphertext, authTag]).toString('base64');

		// --- Upload ------------------------------------------------------------
		const payload = {
			v: 2,
			adata,
			ct,
			meta: { expire },
		};

		const response = (await context.helpers.httpRequest({
			method: 'POST',
			url: baseUrl,
			body: payload,
			json: true,
			headers: {
				'Content-Type': 'application/json',
				'X-Requested-With': 'JSONHttpRequest',
			},
		})) as { status?: number; id?: string; deletetoken?: string; message?: string };

		if (response.status !== 0 || !response.id) {
			throw new Error(`PrivateBin rejected the paste: ${response.message ?? 'unknown error'}`);
		}

		const keyBase58 = toBase58(pasteKey);
		const url = `${baseUrl}/?${response.id}#${keyBase58}`;

		return {
			url,
			pasteId: response.id,
			deleteToken: response.deletetoken ?? '',
		};
	} finally {
		// Defense-in-depth: wipe the key material and the (compressed) plaintext from
		// memory once we're done. The Base58 key inside the returned URL is the secret
		// the user asked us to produce, so that necessarily survives.
		pasteKey.fill(0);
		derivedKey.fill(0);
		compressed.fill(0);
	}
}

export class Pastebin implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Pastebin',
		name: 'pastebin',
		icon: { light: 'file:pastebin.svg', dark: 'file:pastebin.dark.svg' },
		group: ['output'],
		version: 1,
		description:
			'Creates an end-to-end encrypted paste on a PrivateBin instance and returns a shareable link',
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
				default: 'https://secureshare.kscomputing.com/',
				placeholder: 'https://privatebin.example.com/',
				description: 'The URL of the PrivateBin instance',
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
				description: 'The content to be encrypted and pasted',
			},
			{
				displayName: 'Expire',
				name: 'expire',
				type: 'options',
				default: '1week',
				description: 'When the paste should expire',
				options: [
					{ name: '5 Minutes', value: '5min' },
					{ name: '10 Minutes', value: '10min' },
					{ name: '1 Hour', value: '1hour' },
					{ name: '1 Day', value: '1day' },
					{ name: '1 Week', value: '1week' },
					{ name: '1 Month', value: '1month' },
					{ name: '1 Year', value: '1year' },
					{ name: 'Never', value: 'never' },
				],
			},
			{
				displayName: 'Burn After Reading',
				name: 'burnAfterReading',
				type: 'boolean',
				default: false,
				description:
					'Whether the paste is destroyed the first time it is opened. Enable this for one-time secret sharing; leave it off when several people need to open the same link.',
			},
			{
				displayName: 'Format',
				name: 'formatter',
				type: 'options',
				default: 'plaintext',
				description: 'How the paste content is displayed',
				options: [
					{ name: 'Plain Text', value: 'plaintext' },
					{ name: 'Source Code', value: 'syntaxhighlighting' },
					{ name: 'Markdown', value: 'markdown' },
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const pastebinUrl = this.getNodeParameter('pastebinUrl', itemIndex, '') as string;
				const content = this.getNodeParameter('content', itemIndex, '') as string;
				const expire = this.getNodeParameter('expire', itemIndex, '1week') as string;
				const burnAfterReading = this.getNodeParameter(
					'burnAfterReading',
					itemIndex,
					false,
				) as boolean;
				const formatter = this.getNodeParameter('formatter', itemIndex, 'plaintext') as string;

				const result = await createPaste(
					this,
					pastebinUrl,
					content,
					expire,
					burnAfterReading,
					formatter,
				);

				const item = items[itemIndex];
				item.json.pastebinLink = result.url;
				item.json.pasteId = result.pasteId;
				item.json.deleteToken = result.deleteToken;
				returnData.push(item);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: this.getInputData(itemIndex)[0].json,
						error,
						pairedItem: itemIndex,
					});
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

		return [returnData];
	}
}
