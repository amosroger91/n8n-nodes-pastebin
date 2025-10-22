# n8n-nodes-pastebin

This is an n8n node to create pastes on a self-hosted Pastebin instance.

## What is Pastebin?

Pastebin is an open-source, web-based application that allows you to store and share plain text. It is often used to share code snippets, configuration files, or any other type of text. Because it can be self-hosted, it provides a secure way to share secrets and other sensitive information.

This n8n node allows you to interact with your own self-hosted Pastebin instance. You can provide the URL of your instance and the content you want to paste, and the node will generate a secure link to share your text.

## How to use

1.  Add the Pastebin node to your workflow.
2.  In the node's properties, set the URL of your self-hosted Pastebin instance.
3.  Set the content of the paste. This can be a secret, a code snippet, or any other text.
4.  Execute the workflow.

## Output

The node will output the URL of the newly created paste, which you can then share securely.

## License

[MIT](https://github.com/amosroger91/n8n-nodes-pastebin/blob/main/LICENSE.md)
