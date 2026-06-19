<p align="center">
  <img src="images/privatebin-logo.png" alt="PrivateBin" width="320" />
</p>

# n8n-nodes-privatebin

An [n8n](https://n8n.io) community node that creates **end-to-end encrypted [PrivateBin](https://privatebin.info) pastes** and returns a one-click shareable link.

> ⚠️ This node is for **PrivateBin only** — the public [privatebin.net](https://privatebin.net/) instance or your own [self-hosted PrivateBin](https://privatebin.info). It does **not** work with pastebin.com or any other paste service.

Encryption happens entirely inside the node — the PrivateBin server only ever stores ciphertext, and the decryption key travels in the URL fragment (after the `#`), which is never sent to the server. This makes it a clean, secure way to hand sensitive text (a config snippet, a one-time note, a burn-after-reading link) to a downstream step or a human, straight from an automation.

## What is PrivateBin?

[PrivateBin](https://privatebin.info) is an open-source, minimalist, **zero-knowledge** pastebin where the server has no knowledge of the pasted data. Everything is encrypted and decrypted in the browser (or, here, in the node) using 256-bit AES-GCM. You can use the public instance at [privatebin.net](https://privatebin.net/) or run your own.

## Features

- **Client-side encryption** — AES-256-GCM with a 256-bit random key, so the server never sees your plaintext.
- **No browser, no external dependencies** — speaks the PrivateBin v2 API directly using only Node's built-in `crypto`/`zlib`. No Puppeteer, no headless Chrome.
- **Burn after reading** — optionally destroy the paste the moment it is first opened.
- **Configurable expiry** — from 5 minutes up to never.
- **Usable as an AI tool** — can be wired into agent workflows.

## Security model

This node is for sharing **sensitive-but-not-secret** data — text that is already acceptable to have inside your n8n instance, but that you don't want sitting on the open internet.

- **The link is the secret.** The decryption key lives in the URL fragment (after `#`), so anyone with the full link can read the paste. Share it over a trusted channel and prefer short expiry / burn-after-reading for one-time hand-offs.
- **The server never sees plaintext.** Encryption happens entirely in the node; only ciphertext is uploaded.
- **HTTPS is enforced.** The instance URL must be `https://` (plain `http://` is allowed only for `localhost`), so the upload can't be tampered with in transit.
- **Not for credentials.** Use n8n's own credential store for API keys, passwords, and tokens — not this node.

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
n8n-nodes-privatebin
```

Or install manually in your n8n custom nodes directory:

```bash
npm install n8n-nodes-privatebin
```

## Usage

1. Add the **PrivateBin** node to your workflow.
2. Set **PrivateBin URL** to your instance — `https://privatebin.net/` (default) or your own self-hosted PrivateBin.
3. Set **Content** to the text or secret you want to share.
4. (Optional) Choose an **Expire** time, toggle **Burn After Reading**, and pick a **Format**.
5. Execute the workflow.

### Parameters

| Parameter | Description |
| --- | --- |
| **PrivateBin URL** | The URL of your PrivateBin instance (privatebin.net or self-hosted). Must be HTTPS. |
| **Content** | The text to encrypt and paste. |
| **Expire** | When the paste expires (`5min` … `never`). |
| **Burn After Reading** | Delete the paste immediately after it is read once. |
| **Format** | How the paste is displayed (Plain Text, Source Code, Markdown). |

### Output

Each item is enriched with:

| Field | Description |
| --- | --- |
| `privateBinLink` | The full shareable URL, including the decryption key in the fragment. |
| `pasteId` | The PrivateBin paste identifier. |
| `deleteToken` | Token that can be used to delete the paste. |

## Development

```bash
npm install      # install dependencies
npm run build    # compile TypeScript to dist/
npm run lint     # lint against n8n community-node rules
npm test         # build, then run the encryption/roundtrip tests
npm run dev      # run against a local n8n instance
```

## Trademarks & credits

The PrivateBin name, logo, and icon belong to the [PrivateBin project](https://privatebin.info)
and are used here only to identify the service this node integrates with. This is an
independent community node and is not affiliated with or endorsed by the PrivateBin project.

## License

[MIT](https://github.com/amosroger91/n8n-nodes-privatebin/blob/main/LICENSE.md)
