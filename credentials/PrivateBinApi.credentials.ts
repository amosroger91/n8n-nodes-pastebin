import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class PrivateBinApi implements ICredentialType {
	name = 'privateBinApi';

	displayName = 'PrivateBin API';

	documentationUrl = 'https://privatebin.info';

	icon: Icon = 'file:privatebin.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'PrivateBin URL',
			name: 'url',
			type: 'string',
			default: 'https://privatebin.net/',
			placeholder: 'https://privatebin.net/',
			description:
				'URL of the PrivateBin instance — the public privatebin.net or your own self-hosted PrivateBin (https://privatebin.info). Must be HTTPS. Saving this credential verifies the URL is a reachable PrivateBin instance.',
		},
	];
}
