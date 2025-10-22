# n8n-nodes-pastebin

This is an n8n node to create pastes on a self-hosted Pastebin instance.

## What is Pastebin?

Pastebin is an open-source, web-based application that allows you to store and share plain text. It is often used to share code snippets, configuration files, or any other type of text. Because it can be self-hosted, it provides a secure way to share secrets and other sensitive information.

This n8n node allows you to interact with your own self-hosted Pastebin instance. You can provide the URL of your instance and the content you want to paste, and the node will generate a secure link to share your text.

## Dependencies

This node relies on [Puppeteer](https://pptr.dev/), which requires several system-level dependencies to run a headless browser. If you encounter errors related to missing shared libraries (e.g., `libglib-2.0.so.0`), you need to install these dependencies in your n8n environment.

To check for missing dependencies, you can run the `check_puppeteer_deps.sh` script located in the node's directory. This script will identify any missing libraries and provide `apt-get` commands for Debian/Ubuntu-based systems.

**How to run the dependency check script:**

1.  Access the terminal of your n8n container (e.g., `docker exec -it <your-n8n-container-id> bash`).
2.  Navigate to the node's directory (e.g., `/home/node/.n8n/custom/n8n-nodes-pastebin/`).
3.  Run the script:
    ```bash
    ./check_puppeteer_deps.sh
    ```

If the script reports missing dependencies, you will need to install them. For Docker setups, it's recommended to add these installation commands to your Dockerfile to ensure persistence across container rebuilds.

## How to use

1.  Add the Pastebin node to your workflow.
2.  In the node's properties, set the URL of your self-hosted Pastebin instance.
3.  Set the content of the paste. This can be a secret, a code snippet, or any other text.
4.  Execute the workflow.

## Output

The node will output the URL of the newly created paste, which you can then share securely.

## More Information

For more details, including the source code and development information, visit the [GitHub repository](https://github.com/amosroger91/n8n-nodes-pastebin).

## License

[MIT](https://github.com/amosroger91/n8n-nodes-pastebin/blob/main/LICENSE.md)

