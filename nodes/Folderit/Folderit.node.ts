import { createHash } from 'crypto';
import { testFolderitConnection } from './connection-test';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import {
	api,
	request,
	validateUid,
	resolveAccount,
	connectionInfo,
	connectionProperty,
	connectionDeployment,
	storageRequest,
	validateStorageUrl,
} from './api';
export { validateUid } from './api';
import { loadOptions } from './discovery';
import { documentProperties, metadataOperation } from './properties';
import { searchRecords } from './search';
import { executeMetadata } from './metadata';
import {
	controlProperties,
	workflowOperation,
	executeWorkflow,
	listVersions,
	getWorkflows,
} from './control';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, UserError } from 'n8n-workflow';

const properties: INodeProperties[] = [
	{
		displayName: 'Version UID',
		name: 'versionUid',
		type: 'string',
		default: '',
		description:
			'Optional exact version from Get Versions. Blank downloads the current file or preview. An exact version must exist in bounded history before downloading.',
		displayOptions: { show: { resource: ['file'], operation: ['download', 'preview'] } },
	},
	connectionProperty,
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['connection'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get connection context',
				description: 'Verify the deployment and account and return non-secret routing context',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Connection', value: 'connection' },
			{ name: 'File', value: 'file' },
			{ name: 'Folder', value: 'folder' },
			{ name: 'Metadata', value: 'metadata' },
			{ name: 'Workflow', value: 'workflow' },
		],
		default: 'file',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Add Version',
				value: 'addVersion',
				action: 'Add a file version',
				description: 'Upload a new version of an existing file',
			},
			{
				name: 'Download',
				value: 'download',
				action: 'Download a file',
				description: 'Download a file as binary data for the next step',
			},
			{
				name: 'Download Preview',
				value: 'preview',
				action: 'Download a file PDF preview',
				description: 'Download an available PDF preview, optionally for an exact version',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a file',
				description: 'Get file details and metadata',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many files',
				description: 'List files in a folder',
			},
			{
				name: 'Get Versions',
				value: 'getVersions',
				action: 'Get file versions',
				description: 'List the version history of a file',
			},
			{
				name: 'Search',
				value: 'search',
				action: 'Search files',
				description: 'Search document names, content and metadata',
			},
			{
				name: 'Upload',
				value: 'upload',
				action: 'Upload a file',
				description: 'Upload an incoming binary file',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['folder'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a folder',
				description: 'Create a child folder',
			},
			{ name: 'Get', value: 'get', action: 'Get a folder', description: 'Get folder details' },
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many folders',
				description: 'List child folders',
			},
			{
				name: 'Search',
				value: 'search',
				action: 'Search folders',
				description: 'Search folder names and metadata',
			},
		],
		default: 'getAll',
	},
	metadataOperation,
	workflowOperation,
	{
		displayName: 'Account Name or ID',
		name: 'accountUid',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getAccounts' },
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Folder Name or ID',
		name: 'folderUid',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders', loadOptionsDependsOn: ['accountUid'] },
		default: '',
		required: true,
		displayOptions: {
			show: { resource: ['file', 'folder'], operation: ['getAll', 'upload', 'create'] },
		},
		description:
			'Parent or destination folder. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'File UID',
		name: 'fileUid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['get', 'download', 'preview', 'addVersion', 'getVersions'],
			},
		},
	},
	{
		displayName: 'Folder Name or ID',
		name: 'entityUid',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders', loadOptionsDependsOn: ['accountUid'] },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['folder'], operation: ['get'] } },
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['folder'], operation: ['create'] } },
		description: 'Name of the new folder',
	},
	{
		displayName: 'Return Existing Folder',
		name: 'returnDuplicateFolder',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['folder'], operation: ['create'] } },
		description: 'Whether to return an existing same-name folder instead of creating another',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: { resource: ['file', 'folder'], operation: ['getAll', 'search', 'getVersions'] },
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: {
				resource: ['file', 'folder'],
				operation: ['getAll', 'search', 'getVersions'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryField',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['file'], operation: ['download', 'preview'] } },
		description: 'Name of the output binary field containing the downloaded file',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['file'], operation: ['upload', 'addVersion'] } },
		description: 'Name of the input binary field containing the file to upload',
	},
	...documentProperties,
	...controlProperties,
	{
		displayName: 'Expected Connection Scope',
		name: 'expectedConnectionScope',
		type: 'string',
		default: '',
		description:
			'Optional safety check: use connectionScope from a previous Connection/Get step. A different deployment or account stops before this action. This does not change routing.',
		displayOptions: { hide: { resource: ['connection'] } },
	},
];

const binaryOperations = new Set(['upload', 'addVersion', 'download', 'preview']);
const toolAwareProperties = properties.flatMap((property): INodeProperties[] => {
	if (property.name !== 'operation' || property.displayOptions?.show?.resource?.[0] !== 'file')
		return [property];
	return [
		{ ...property, displayOptions: { show: { resource: ['file'], '@tool': [false] } } },
		{
			...property,
			displayOptions: { show: { resource: ['file'], '@tool': [true] } },
			options: property.options?.filter(
				(option) => 'value' in option && !binaryOperations.has(String(option.value)),
			),
		},
	];
});

// Signed storage URLs never receive the Folderit OAuth credentials.
export const validateUploadUrl = validateStorageUrl;

export class Folderit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Folderit',
		name: 'folderit',
		icon: { light: 'file:folderit.svg', dark: 'file:folderit.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage documents and folders in Folderit',
		defaults: { name: 'Folderit' },
		// JSON operations work as tools; binary operations remain in normal workflows.
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'folderitOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['folderitOAuth2Api'] } },
			},
			{
				name: 'folderitApi',
				required: true,
				testedBy: 'testFolderitConnection',
				displayOptions: { show: { authentication: ['folderitApi'] } },
			},
		],
		properties: toolAwareProperties,
	};

	methods = {
		credentialTest: { testFolderitConnection },
		loadOptions: { ...loadOptions, getWorkflows },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const output: INodeExecutionData[] = [];
		for (let i = 0; i < this.getInputData().length; i++) {
			try {
				const get = (name: string) => this.getNodeParameter(name, i) as string;
				const resource = get('resource');
				const operation = get('operation');
				if (
					this.getNode().type.endsWith('Tool') &&
					resource === 'file' &&
					binaryOperations.has(operation)
				)
					throw new UserError(
						'Binary file operations require a normal Folderit workflow node, not an AI tool.',
					);
				const account = await resolveAccount(this, get('accountUid'));
				const expectedScope = String(this.getNodeParameter('expectedConnectionScope', i, '') || '');
				if (
					expectedScope &&
					expectedScope !== JSON.stringify([(await connectionDeployment(this)).apiOrigin, account])
				)
					throw new UserError(
						'The selected Folderit credential does not match the expected deployment/account. No action was attempted.',
					);
				let results: IDataObject[];
				if (resource === 'connection') {
					results = [await connectionInfo(this, account)];
				} else if (resource === 'metadata') {
					results = await executeMetadata(this, account, operation, i);
				} else if (resource === 'workflow') {
					results = await executeWorkflow(this, account, operation, i);
				} else if (resource === 'file' && operation === 'getVersions') {
					results = await listVersions(
						this,
						account,
						validateUid(get('fileUid')),
						this.getNodeParameter('returnAll', i)
							? 10000
							: Number(this.getNodeParameter('limit', i)),
					);
				} else if (operation === 'search' && ['file', 'folder'].includes(resource)) {
					results = await searchRecords(this, account, resource, i);
				} else if (resource === 'file' && ['download', 'preview'].includes(operation)) {
					const uid = validateUid(get('fileUid'));
					const field = get('outputBinaryField').trim();
					if (!field || ['__proto__', 'constructor', 'prototype'].includes(field))
						throw new UserError('Enter a valid output binary field name.');
					const file = await request(this, account, 'GET', `/files/${uid}`);
					const versionUid = String(this.getNodeParameter('versionUid', i, '') || '').trim();
					let selectedVersion: IDataObject | undefined;
					if (versionUid) {
						validateUid(versionUid);
						selectedVersion = (await listVersions(this, account, uid, 1000)).find(
							(v) => v.versionUid === versionUid,
						);
						if (!selectedVersion)
							throw new UserError(
								'The exact version was not found in bounded history. No download was attempted.',
							);
					}
					const preview = operation === 'preview';
					if (preview && (selectedVersion || file).previewAvailable !== true)
						throw new UserError(
							'The selected file/version does not have an available PDF preview. Wait for processing or check its permissions.',
						);
					try {
						const response = await api(
							this,
							`/accounts/${account}/files/${uid}${versionUid ? `/versions/${versionUid}` : ''}/${preview ? 'preview' : 'download'}`,
							{
								method: 'GET',
								json: false,
								disableFollowRedirect: true,
								returnFullResponse: true,
								ignoreHttpStatusErrors: true,
								timeout: 60000,
							},
						);
						if (![302, 303].includes(response.statusCode))
							throw new UserError('Unexpected download response.');
						const url = response.headers.location;
						// Download anonymously and stream into n8n's binary storage.
						const stream = await storageRequest(this, {
							method: 'GET',
							url,
							encoding: 'stream',
							disableFollowRedirect: true,
							timeout: 120000,
						});
						const binary = await this.helpers.prepareBinaryData(
							stream,
							preview
								? `${String(file.name || uid).replace(/\.[^.]+$/, '')}.pdf`
								: typeof file.name === 'string'
									? file.name
									: uid,
							preview
								? 'application/pdf'
								: typeof file.mimeType === 'string'
									? file.mimeType
									: undefined,
						);
						if (selectedVersion || preview) {
							const hash = createHash('sha256');
							let size = 0;
							let prefix = Buffer.alloc(0);
							const downloaded = binary.id
								? await this.helpers.getBinaryStream(binary.id)
								: [Buffer.from(binary.data, 'base64')];
							for await (const chunk of downloaded) {
								const bytes = Buffer.from(chunk);
								hash.update(bytes);
								size += bytes.length;
								if (prefix.length < 5)
									prefix = Buffer.concat([prefix, bytes.subarray(0, 5 - prefix.length)]);
							}
							const sha256 = hash.digest('hex');
							if (preview && prefix.toString() !== '%PDF-')
								throw new UserError('The preview response was not a PDF.');
							if (selectedVersion && !preview) {
								const expected = (selectedVersion.hash as IDataObject | undefined)?.sha256;
								if (
									typeof selectedVersion.size !== 'number' ||
									selectedVersion.size !== size ||
									(expected && String(expected).toLowerCase() !== sha256)
								)
									throw new UserError('The downloaded version bytes did not match history.');
							}
							Object.assign(file, {
								downloadedSize: size,
								downloadedSha256: sha256,
								...(versionUid ? { downloadedVersionUid: versionUid } : {}),
								...(preview ? { downloadedPreview: true } : {}),
							});
						}
						output.push({ json: file, binary: { [field]: binary }, pairedItem: { item: i } });
						continue;
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							error instanceof UserError
								? `File download failed. ${error.message}`
								: 'File download failed. Check file access and try again.',
							{ itemIndex: i },
						);
					}
				} else if (operation === 'get') {
					const uid = validateUid(get(resource === 'file' ? 'fileUid' : 'entityUid'));
					results = [
						await request(
							this,
							account,
							'GET',
							`/${resource === 'file' ? 'files' : 'folders'}/${uid}`,
							undefined,
							{ expand: 'meta' },
						),
					];
				} else if (operation === 'getAll') {
					const parent = validateUid(get('folderUid'));
					const all = this.getNodeParameter('returnAll', i) as boolean;
					const limit = all ? Infinity : (this.getNodeParameter('limit', i) as number);
					if (!all && (!Number.isInteger(limit) || limit < 1))
						throw new UserError('Limit must be a positive integer.');
					results = [];
					let page = 1;
					// Keep the page size constant: changing it changes the API's page offset.
					const size = Math.min(100, limit);
					while (results.length < limit) {
						if (page > 1000)
							throw new UserError(
								'Listing exceeded 1,000 pages. Use a smaller folder or a result limit.',
							);
						const rows = await request(
							this,
							account,
							'GET',
							`/folders/${parent}/${resource === 'file' ? 'files' : 'folders'}`,
							undefined,
							{ page, 'per-page': size },
						);
						if (!Array.isArray(rows)) throw new UserError('Unexpected Folderit list response.');
						results.push(...rows.slice(0, limit - results.length));
						if (rows.length < size) break;
						page++;
					}
				} else if (resource === 'folder' && operation === 'create') {
					const name = get('name').trim();
					if (!name) throw new UserError('Folder name must not be empty.');
					results = [
						await request(this, account, 'POST', '/folders', {
							name,
							parentUid: validateUid(get('folderUid')),
							returnDuplicateFolder: this.getNodeParameter('returnDuplicateFolder', i) as boolean,
						}),
					];
				} else if (resource === 'file' && ['upload', 'addVersion'].includes(operation)) {
					const target =
						operation === 'addVersion'
							? { fileUid: validateUid(get('fileUid')) }
							: { folderUid: validateUid(get('folderUid')) };
					const lock =
						operation === 'addVersion'
							? String(this.getNodeParameter('versionLockId', i, '')).trim()
							: '';
					const headers = lock ? { 'X-Folderit-Lock': lock } : undefined;
					if (target.fileUid) await request(this, account, 'GET', `/files/${target.fileUid}`);
					const property = get('binaryPropertyName');
					const binary = this.helpers.assertBinaryData(i, property);
					const buffer = await this.helpers.getBinaryDataBuffer(i, property);
					// Bound memory usage for this first release; large-file streaming is a separate feature.
					if (buffer.length === 0 || buffer.length > 100 * 1024 * 1024)
						throw new UserError('Upload a non-empty file no larger than 100 MiB.');
					const fileName = binary.fileName || 'document';
					const fileSize = buffer.length;
					const session = await request(
						this,
						account,
						'POST',
						'/files/upload',
						{
							action: 'create',
							...target,
							fileName,
							fileSize,
							contentType: binary.mimeType || 'application/octet-stream',
						},
						undefined,
						headers,
					);
					if (typeof session.uploadId !== 'string' || typeof session.key !== 'string')
						throw new UserError('Folderit returned an invalid upload session.');
					const upload = { uploadId: session.uploadId, key: session.key };
					try {
						const partSize = 10 * 1024 * 1024;
						for (
							let offset = 0, partNumber = 1;
							offset < fileSize;
							offset += partSize, partNumber++
						) {
							const chunk = buffer.subarray(offset, Math.min(offset + partSize, fileSize));
							const part = await request(this, account, 'POST', '/files/upload', {
								action: 'part',
								...upload,
								partNumber,
								contentLength: chunk.length,
							});
							const url = part.url;
							try {
								await storageRequest(this, {
									method: 'PUT',
									url,
									body: chunk,
									headers: { 'Content-Length': String(chunk.length) },
									timeout: 120000,
									disableFollowRedirect: true,
								});
							} catch {
								throw new NodeOperationError(
									this.getNode(),
									'Storage upload failed. The unfinished upload will be aborted.',
								);
							}
						}
					} catch (error) {
						try {
							await request(this, account, 'POST', '/files/upload', { action: 'abort', ...upload });
						} catch {
							/* The API also expires unfinished uploads. */
						}
						throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
					}
					// A lost completion response is ambiguous. Do not retry automatically: check the destination first.
					try {
						results = [
							await request(
								this,
								account,
								'POST',
								'/files/upload',
								{
									action: 'complete',
									...upload,
									...target,
									fileName,
									fileSize,
								},
								undefined,
								headers,
							),
						];
					} catch {
						throw new NodeOperationError(
							this.getNode(),
							'Could not confirm upload completion. Check the destination folder or file version history before retrying to avoid a duplicate.',
						);
					}
				} else {
					throw new UserError('Unsupported Folderit resource or operation.');
				}
				for (const json of results) output.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), { message: error.message }, { itemIndex: i });
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [output];
	}
}
