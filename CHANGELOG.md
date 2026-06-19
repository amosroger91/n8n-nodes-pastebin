# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

> **Renamed from `n8n-nodes-pastebin` to `n8n-nodes-privatebin`.** The node is now
> called **PrivateBin** and the package, repository, and branding all reflect that it
> works with PrivateBin (privatebin.net and self-hosted instances) only — not
> pastebin.com or any other paste service.

### Added

- Native, end-to-end encrypted paste creation using the PrivateBin v2 protocol
  (AES-256-GCM, PBKDF2-HMAC-SHA256, raw DEFLATE, Base58 key in the URL fragment),
  implemented with Node built-ins only.
- New node options: **Expire**, **Burn After Reading**, and **Format**.
- Output now includes `pasteId` and `deleteToken` alongside `privateBinLink`.
- **PrivateBin API credential** holding the instance URL, with a connection test that
  runs on save: it confirms the URL is reachable and is a genuine PrivateBin instance
  (by fetching the read-only JSON-LD paste schema), rejecting unreachable URLs and
  non-PrivateBin services.

### Changed (branding / rename)

- Node renamed `Pastebin` → `PrivateBin`; package `n8n-nodes-pastebin` →
  `n8n-nodes-privatebin`.
- Default instance URL is now `https://privatebin.net/`.
- Output field `pastebinLink` renamed to `privateBinLink`; the instance URL now lives
  in a **PrivateBin API** credential instead of an inline node field.
- HTTPS enforcement for the instance URL (plain `http://` allowed only for `localhost`).
- Automated tests covering the encryption roundtrip, Base58, key/nonce uniqueness,
  and URL validation.
- `Security model` section in the README.

### Changed

- Replaced the Puppeteer/headless-Chrome browser automation with a direct API client.
  The server now only ever receives ciphertext.
- The paste key, derived key, and compressed plaintext are zeroed from memory after use.

### Removed

- The `puppeteer` dependency.
- Leftover scaffolding: the `Example` and `GithubIssues` nodes and the GitHub
  credential types (this package now ships the Pastebin node only).
