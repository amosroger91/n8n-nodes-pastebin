// Tests run against the COMPILED node in dist/ (see the "test" script, which builds first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { buildEncryptedPaste, toBase58, resolveBaseUrl } from '../dist/nodes/PrivateBin/PrivateBin.node.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function fromBase58(str) {
	let value = 0n;
	for (const char of str) {
		const idx = BASE58_ALPHABET.indexOf(char);
		assert.notEqual(idx, -1, `invalid base58 char: ${char}`);
		value = value * 58n + BigInt(idx);
	}
	const out = [];
	while (value > 0n) {
		out.unshift(Number(value % 256n));
		value = value / 256n;
	}
	for (const char of str) {
		if (char === '1') out.unshift(0);
		else break;
	}
	return Buffer.from(out);
}

// Independent reference decryptor — mirrors what a PrivateBin reader does.
function decrypt({ adata, ct }, keyBase58) {
	const key = fromBase58(keyBase58);
	const iv = Buffer.from(adata[0][0], 'base64');
	const salt = Buffer.from(adata[0][1], 'base64');
	const derived = pbkdf2Sync(key, salt, 100000, 32, 'sha256');
	const buf = Buffer.from(ct, 'base64');
	const tag = buf.subarray(buf.length - 16);
	const body = buf.subarray(0, buf.length - 16);
	const decipher = createDecipheriv('aes-256-gcm', derived, iv, { authTagLength: 16 });
	decipher.setAAD(Buffer.from(JSON.stringify(adata), 'utf8'));
	decipher.setAuthTag(tag);
	const plain = Buffer.concat([decipher.update(body), decipher.final()]);
	return JSON.parse(inflateRawSync(plain).toString('utf8')).paste;
}

test('toBase58 roundtrips arbitrary bytes', () => {
	const samples = [
		Buffer.from([0, 0, 0, 1, 2, 3]),
		Buffer.from('hello world', 'utf8'),
		Buffer.from('ff00ff00aabb', 'hex'),
	];
	for (const s of samples) {
		assert.equal(Buffer.compare(fromBase58(toBase58(s)), s), 0);
	}
});

test('toBase58 preserves leading zero bytes as 1s', () => {
	assert.equal(toBase58(Buffer.from([0, 0, 1])), '112');
});

test('encrypt produces a PrivateBin-compatible, decryptable paste', () => {
	const secret = 'multi\nline "quoted" secret — é 🔐 \t end';
	const paste = buildEncryptedPaste(secret, true, 'plaintext');

	// Shape / spec checks.
	assert.equal(paste.adata[0][2], 100000, 'PBKDF2 iterations');
	assert.equal(paste.adata[0][3], 256, 'key size');
	assert.equal(paste.adata[0][4], 128, 'tag size');
	assert.deepEqual(paste.adata[0].slice(5), ['aes', 'gcm', 'zlib']);
	assert.equal(paste.adata[1], 'plaintext', 'formatter');
	assert.equal(paste.adata[3], 1, 'burn-after-reading flag set');

	// Round-trips back to the original plaintext.
	assert.equal(decrypt(paste, paste.keyBase58), secret);
});

test('burn flag is 0 when disabled', () => {
	const paste = buildEncryptedPaste('x', false, 'markdown');
	assert.equal(paste.adata[3], 0);
	assert.equal(paste.adata[1], 'markdown');
});

test('each paste uses fresh key/nonce/salt (no reuse)', () => {
	const a = buildEncryptedPaste('same content', false, 'plaintext');
	const b = buildEncryptedPaste('same content', false, 'plaintext');
	assert.notEqual(a.keyBase58, b.keyBase58, 'keys must differ');
	assert.notEqual(a.adata[0][0], b.adata[0][0], 'nonces must differ');
	assert.notEqual(a.adata[0][1], b.adata[0][1], 'salts must differ');
	assert.notEqual(a.ct, b.ct, 'ciphertext must differ');
});

test('resolveBaseUrl enforces HTTPS and validates input', () => {
	assert.equal(resolveBaseUrl('https://pb.example.com/'), 'https://pb.example.com');
	assert.equal(resolveBaseUrl('https://pb.example.com///'), 'https://pb.example.com');
	// http allowed only for localhost
	assert.equal(resolveBaseUrl('http://localhost:8080/'), 'http://localhost:8080');
	assert.throws(() => resolveBaseUrl('http://pb.example.com'), /HTTPS/);
	assert.throws(() => resolveBaseUrl('not a url'), /Invalid/);
});
