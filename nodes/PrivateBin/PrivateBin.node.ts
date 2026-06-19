import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
// The no-restricted-imports rule targets n8n Cloud (which sandboxes community nodes).
// This node is for self-hosted PrivateBin instances, and raw DEFLATE is required by the
// PrivateBin wire format, so the restriction does not apply here.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { deflateRawSync } from 'node:zlib';

/*
 * ============================================================================
 *  PrivateBin v2 client — written FOR THIS OPEN-SOURCE PROJECT ONLY.
 * ============================================================================
 *
 *  This is a from-scratch, dependency-free reimplementation of the PrivateBin
 *  v2 "create paste" protocol, built specifically for the open-source
 *  `n8n-nodes-privatebin` community node (https://github.com/amosroger91/n8n-nodes-privatebin).
 *  It targets PrivateBin (https://privatebin.info) only — both privatebin.net and
 *  self-hosted PrivateBin instances. It is NOT compatible with pastebin.com or any
 *  other paste service.
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

export function toBase58(bytes: Buffer): string {
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

interface EncryptedPaste {
	// The PrivateBin `adata` array (encryption spec + paste metadata).
	adata: Array<string | number | Array<string | number>>;
	// Base64 ciphertext with the GCM auth tag appended.
	ct: string;
	// Base58-encoded paste key, destined for the URL fragment.
	keyBase58: string;
}

// Hosts for which plain HTTP is tolerated (local PrivateBin instances / testing).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function resolveBaseUrl(baseUrlRaw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(baseUrlRaw);
	} catch {
		throw new ApplicationError(`Invalid PrivateBin URL: "${baseUrlRaw}". Expected something like https://privatebin.net/`);
	}

	// The shareable link (key in the fragment) is meant for the open internet, so the
	// upload channel itself must be authenticated. Reject plain HTTP except on localhost.
	if (parsed.protocol !== 'https:' && !LOCAL_HOSTS.has(parsed.hostname)) {
		throw new ApplicationError(
			`PrivateBin URL must use HTTPS (got "${parsed.protocol}//"). Plain HTTP would let the network tamper with the paste. ` +
				'Use an https:// URL (http:// is only allowed for localhost).',
		);
	}

	return baseUrlRaw.replace(/\/+$/, '');
}

/**
 * Encrypts a secret into the PrivateBin v2 paste format. Pure (no network), so it
 * can be unit-tested in isolation. Returns the `adata`, base64 ciphertext, and the
 * Base58 key for the URL fragment.
 */
export function buildEncryptedPaste(
	secret: string,
	burnAfterReading: boolean,
	formatter: string,
): EncryptedPaste {
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
		const adata: EncryptedPaste['adata'] = [
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

		return { adata, ct, keyBase58: toBase58(pasteKey) };
	} finally {
		// Defense-in-depth: wipe the key material and the (compressed) plaintext from
		// memory once we're done. The Base58 key inside the returned URL is the secret
		// the user asked us to produce, so that necessarily survives.
		pasteKey.fill(0);
		derivedKey.fill(0);
		compressed.fill(0);
	}
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
	const { adata, ct, keyBase58 } = buildEncryptedPaste(secret, burnAfterReading, formatter);

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
		throw new ApplicationError(`PrivateBin rejected the paste: ${response.message ?? 'unknown error'}`);
	}

	return {
		url: `${baseUrl}/?${response.id}#${keyBase58}`,
		pasteId: response.id,
		deleteToken: response.deletetoken ?? '',
	};
}

export class PrivateBin implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PrivateBin',
		name: 'privateBin',
		icon: { light: 'file:privatebin.svg', dark: 'file:privatebin.dark.svg' },
		group: ['output'],
		version: 1,
		description:
			'Create an end-to-end encrypted PrivateBin paste and return a shareable link. Works with PrivateBin (privatebin.net and self-hosted instances) only.',
		defaults: {
			name: 'PrivateBin',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'PrivateBin URL',
				name: 'privateBinUrl',
				type: 'string',
				default: 'https://privatebin.net/',
				placeholder: 'https://privatebin.net/',
				description:
					'The URL of the PrivateBin instance (the public privatebin.net or your own self-hosted PrivateBin — see https://privatebin.info). This node only works with PrivateBin, not pastebin.com or other paste services.',
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
					{ name: '1 Day', value: '1day' },
					{ name: '1 Hour', value: '1hour' },
					{ name: '1 Month', value: '1month' },
					{ name: '1 Week', value: '1week' },
					{ name: '1 Year', value: '1year' },
					{ name: '10 Minutes', value: '10min' },
					{ name: '5 Minutes', value: '5min' },
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
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'Plain Text', value: 'plaintext' },
					{ name: 'Source Code', value: 'syntaxhighlighting' },
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const privateBinUrl = this.getNodeParameter('privateBinUrl', itemIndex, '') as string;
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
					privateBinUrl,
					content,
					expire,
					burnAfterReading,
					formatter,
				);

				const item = items[itemIndex];
				item.json.privateBinLink = result.url;
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
