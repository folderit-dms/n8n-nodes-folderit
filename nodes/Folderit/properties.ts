import type { INodeProperties } from 'n8n-workflow';
export const metadataOperation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['metadata'] } },
	default: 'get',
	options: [
		{
			name: 'Get',
			value: 'get',
			action: 'Get record metadata',
			description: 'Read metadata assigned to a file or folder',
		},
		{
			name: 'Get Many Fields',
			value: 'getFields',
			action: 'Get many metadata fields',
			description: 'List available metadata definitions and types',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update typed metadata',
			description: 'Validate, save and verify one exact metadata field',
		},
	],
};
export const documentProperties: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		default: '',
		displayOptions: { show: { operation: ['search'] } },
		description: 'Search text. Supply a query or at least one filter.',
	},
	{
		displayName: 'Search In',
		name: 'queryFields',
		type: 'multiOptions',
		default: ['name'],
		displayOptions: { show: { operation: ['search'] } },
		options: [
			{ name: 'Content', value: 'content' },
			{ name: 'Document Number', value: 'number' },
			{ name: 'Metadata', value: 'meta' },
			{ name: 'Name', value: 'name' },
			{ name: 'Tag', value: 'tag' },
		],
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { operation: ['search'] } },
		options: [
			{ displayName: 'Document Number', name: 'number', type: 'string', default: '' },
			{
				displayName: 'Extension',
				name: 'extension',
				type: 'string',
				default: '',
				description: 'File extension without a leading dot, for example pdf',
			},
			{
				displayName: 'Parent Folder Name or ID',
				name: 'parentUid',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getFolders', loadOptionsDependsOn: ['accountUid'] },
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	},
	{
		displayName: 'Record UID',
		name: 'recordUid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['metadata'], operation: ['get', 'update'] } },
		description: 'Exact UID of the file or folder',
	},
	{
		displayName: 'Metadata Field Name or ID',
		name: 'metadataUid',
		type: 'options',
		default: '',
		required: true,
		typeOptions: { loadOptionsMethod: 'getMetadata', loadOptionsDependsOn: ['accountUid'] },
		displayOptions: { show: { resource: ['metadata'], operation: ['update'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Value Input',
		name: 'valueInput',
		type: 'options',
		default: 'json',
		options: [
			{ name: 'JSON Value', value: 'json' },
			{ name: 'Select Option', value: 'select' },
			{ name: 'Clear Value', value: 'clear' },
		],
		displayOptions: { show: { resource: ['metadata'], operation: ['update'] } },
	},
	{
		displayName: 'Value (JSON)',
		name: 'valueJson',
		type: 'json',
		default: '""',
		required: true,
		displayOptions: {
			show: { resource: ['metadata'], operation: ['update'], valueInput: ['json'] },
		},
		description:
			'A typed JSON value, such as "Approved", 42 or true. Multiple fields require arrays; table fields require rows.',
	},
	{
		displayName: 'Select Option Name or ID',
		name: 'selectOptionUid',
		type: 'options',
		default: '',
		required: true,
		typeOptions: {
			loadOptionsMethod: 'getSelectOptions',
			loadOptionsDependsOn: ['accountUid', 'metadataUid'],
		},
		displayOptions: {
			show: { resource: ['metadata'], operation: ['update'], valueInput: ['select'] },
		},
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'File Lock ID',
		name: 'fileLockId',
		type: 'string',
		default: '',
		typeOptions: { password: true },
		displayOptions: { show: { resource: ['metadata'], operation: ['update'] } },
		description:
			'Existing lock ID when required by Folderit. This operation never overrides a lock.',
	},
];
