# n8n-nodes-pastebin

An [n8n](https://n8n.io) community node that creates **end-to-end encrypted** pastes on a [PrivateBin](https://privatebin.info) instance and returns a one-click shareable link.

Encryption happens entirely inside the node — the PrivateBin server only ever stores ciphertext, and the decryption key travels in the URL fragment (after the `#`), which is never sent to the server. This makes it a clean, secure way to hand secrets (passwords, tokens, config) to a downstream step or a human, straight from an automation.

## Features

- **Client-side encryption** — AES-256-GCM with a 256-bit random key, so the server never sees your plaintext.
- **No browser, no external services** — speaks the PrivateBin v2 API directly using only Node's built-in `crypto` and `zlib`. No Puppeteer, no headless Chrome, no extra runtime dependencies.
- **Burn after reading** — optionally destroy the paste the moment it is first opened.
- **Configurable expiry** — from 5 minutes up to never.
- **Usable as an AI tool** — can be wired into agent workflows.

## How it works

The node implements the PrivateBin v2 paste protocol:

1. Generates a random 256-bit paste key and Base58-encodes it into the URL fragment.
2. Derives an AES key with PBKDF2-HMAC-SHA256 (100,000 iterations, 64-bit salt).
3. Compresses the payload with raw DEFLATE.
4. Encrypts it with AES-256-GCM (96-bit nonce, 128-bit auth tag), authenticating the encryption spec as additional data.
5. Uploads only the ciphertext, then builds the shareable `…/?<id>#<key>` link.

> The PrivateBin client in this package was written from scratch **for this open-source project**. It is not affiliated with, or an official library of, the PrivateBin project.

## Installation

In n8n, go to **Settings → Community Nodes → Install** and enter:

```
n8n-nodes-pastebin
```

Or install manually in your n8n custom nodes directory:

```bash
npm install n8n-nodes-pastebin
```

## Usage

1. Add the **Pastebin** node to your workflow.
2. Set **Pastebin URL** to your PrivateBin instance (e.g. `https://privatebin.example.com/`).
3. Set **Content** to the text or secret you want to share.
4. (Optional) Choose an **Expire** time, toggle **Burn After Reading**, and pick a **Format**.
5. Execute the workflow.

### Parameters

| Parameter | Description |
| --- | --- |
| **Pastebin URL** | The URL of your PrivateBin instance. |
| **Content** | The text to encrypt and paste. |
| **Expire** | When the paste expires (`5min` … `never`). |
| **Burn After Reading** | Delete the paste immediately after it is read once. |
| **Format** | How the paste is displayed (Plain Text, Source Code, Markdown). |

### Output

Each item is enriched with:

| Field | Description |
| --- | --- |
| `pastebinLink` | The full shareable URL, including the decryption key in the fragment. |
| `pasteId` | The PrivateBin paste identifier. |
| `deleteToken` | Token that can be used to delete the paste. |

## Development

```bash
npm install      # install dependencies
npm run build    # compile TypeScript to dist/
npm run lint     # lint against n8n community-node rules
npm run dev      # run against a local n8n instance
```

## License

[MIT](https://github.com/amosroger91/n8n-nodes-pastebin/blob/main/LICENSE.md)
