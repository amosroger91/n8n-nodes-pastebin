import { config } from '@n8n/node-cli/eslint';

export default [
  ...config,
  {
    ignores: ['nodes/Pastebin/Pastebin.node.ts'],
  },
];
