import type { INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { loadOptions } from './discovery';
import { pollEvents } from './polling';
export class FolderitTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Folderit Trigger',
		name: 'folderitTrigger',
		icon: { light: 'file:folderit.svg', dark: 'file:folderit.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Start workflows when Folderit documents or tasks change',
		defaults: { name: 'Folderit Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'folderitOAuth2Api', required: true }],
		properties: [
			{
				displayName: 'Account Name or ID',
				name: 'accountUid',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAccounts' },
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				default: 'newFile',
				required: true,
				options: [
					{ name: 'Metadata Changed', value: 'metadataChanged' },
					{ name: 'New File', value: 'newFile' },
					{ name: 'New File Version', value: 'newVersion' },
					{ name: 'New Folder', value: 'newFolder' },
					{ name: 'Record Changed', value: 'recordChanged' },
					{ name: 'Workflow Task Event', value: 'workflowEvent' },
				],
			},
			{
				displayName: 'Record UID',
				name: 'recordUid',
				type: 'string',
				default: '',
				description:
					'Optional exact file or folder UID. Leave blank to watch permitted account events.',
			},
			{
				displayName:
					'Activation watches new events from that point onward. Manual testing previews up to 10 recent matching events. Poll at least hourly; interruptions over 23 hours require reconciliation.',
				name: 'pollingNotice',
				type: 'notice',
				default: '',
			},
		],
	};
	methods = { loadOptions: { getAccounts: loadOptions.getAccounts } };
	async poll(this: IPollFunctions) {
		return pollEvents(this);
	}
}
