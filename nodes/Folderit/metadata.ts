import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError, UserError } from 'n8n-workflow';
import { collection, request, validateUid } from './api';
import { definitions } from './discovery';
type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export interface Definition {
	uid: string;
	name?: string;
	type: string;
	multiple?: boolean;
	decimalScale?: number;
	permissions?: { canUpdate?: boolean };
	options?: Array<{ uid: string }>;
	data?: { table?: { columns?: Array<{ key: string }> } };
	columns?: Array<{ key: string }>;
}
const types = new Set([
	'string',
	'text',
	'integer',
	'float',
	'date',
	'datetime',
	'time',
	'boolean',
	'url',
	'email',
	'select',
	'user',
	'entity',
	'table',
]);
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function calendar(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateTable(def: Definition, value: unknown): Value {
	const columns = def.data?.table?.columns ?? def.columns;
	if (!Array.isArray(columns) || !columns.length || columns.length > 50)
		throw new UserError('Table definition must expose 1 to 50 columns.');
	const order = new Map<string, number>();
	columns.forEach((c, i) => {
		if (!/^[A-Za-z_][A-Za-z0-9_-]{0,254}$/.test(c.key) || order.has(c.key))
			throw new UserError('Table definition contains invalid or repeated column keys.');
		order.set(c.key, i);
	});
	if (
		!object(value) ||
		Object.keys(value).some((k) => !['rowCount', 'rows'].includes(k)) ||
		!Array.isArray(value.rows) ||
		value.rows.length > 10000
	)
		throw new UserError('Table value must contain rows (at most 10,000) and optional rowCount.');
	if (value.rowCount !== undefined && value.rowCount !== value.rows.length)
		throw new UserError('Table rowCount must match rows.');
	const rows = value.rows.map((row: unknown, index: number) => {
		if (!Array.isArray(row) || !row.length || row.length > 50)
			throw new UserError(`Table row ${index + 1} must contain 1 to 50 cells.`);
		const seen = new Set<string>();
		return row
			.map((cell: unknown) => {
				if (
					!object(cell) ||
					Object.keys(cell).some((k) => !['key', 'value'].includes(k)) ||
					typeof cell.key !== 'string' ||
					!order.has(cell.key) ||
					seen.has(cell.key)
				)
					throw new UserError(`Table row ${index + 1} contains an invalid or repeated column key.`);
				seen.add(cell.key);
				const v = cell.value;
				if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
					throw new UserError('Table cell values must be text, numbers, booleans or null.');
				if (
					(typeof v === 'number' && !Number.isFinite(v)) ||
					(typeof v === 'string' && v.length > 10240)
				)
					throw new UserError('Table cell value is out of range.');
				return { key: cell.key, value: v };
			})
			.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
	});
	return { rowCount: rows.length, rows };
}
function scalar(def: Definition, value: unknown): Value {
	if (value === null) return null;
	switch (def.type) {
		case 'string':
		case 'text': {
			if (typeof value !== 'string' || !value.normalize('NFC').trim())
				throw new UserError(
					'Text metadata must be a non-empty string. Use Clear Value to remove a value.',
				);
			const v = value.normalize('NFC');
			if (def.type === 'string' && v.length > 512)
				throw new UserError('String metadata is limited to 512 characters.');
			return v;
		}
		case 'integer':
			if (typeof value !== 'number' || !Number.isSafeInteger(value))
				throw new UserError('Integer metadata requires a safe integer.');
			return value;
		case 'float': {
			const v = typeof value === 'number' ? String(value) : value;
			const scale = def.decimalScale ?? 18;
			if (!Number.isInteger(scale) || scale < 0 || scale > 18)
				throw new UserError('Metadata decimal scale is invalid.');
			if (
				typeof v !== 'string' ||
				!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) ||
				(v.split('.')[1] ?? '').length > scale
			)
				throw new UserError(
					`Decimal metadata requires a decimal number or string with at most ${scale} decimal places.`,
				);
			return v;
		}
		case 'date':
			if (typeof value !== 'string' || !calendar(value))
				throw new UserError('Date metadata requires a real YYYY-MM-DD date.');
			return value;
		case 'datetime':
			if (
				typeof value !== 'string' ||
				!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
				!calendar(value.slice(0, 10)) ||
				!Number.isFinite(Date.parse(value))
			)
				throw new UserError(
					'Datetime metadata requires an ISO timestamp with an explicit timezone.',
				);
			return new Date(value).toISOString();
		case 'time':
			if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value))
				throw new UserError('Time metadata requires HH:mm:ss.');
			return value;
		case 'boolean':
			if (typeof value !== 'boolean')
				throw new UserError('Boolean metadata requires true or false.');
			return value;
		case 'email':
			if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
				throw new UserError('Email metadata requires a valid email address.');
			return value;
		case 'url': {
			if (typeof value !== 'string' || !/^https?:\/\//.test(value))
				throw new UserError('URL metadata requires an absolute HTTP or HTTPS URL.');
			const parsed = new URL(value);
			return parsed.toString();
		}
		case 'select': {
			const uid = typeof value === 'string' ? validateUid(value) : '';
			if (!uid || !Array.isArray(def.options) || !def.options.some((o) => o.uid === uid))
				throw new UserError('Select value must be an option UID belonging to this metadata field.');
			return uid;
		}
		case 'user':
		case 'entity':
			if (typeof value !== 'string')
				throw new UserError('Reference metadata requires an exact UID.');
			return validateUid(value);
		case 'table':
			return validateTable(def, value);
		default:
			throw new UserError('Unsupported metadata type.');
	}
}
export function validateTypedValue(def: Definition, value: unknown): Value {
	if (!types.has(def.type)) throw new UserError(`Unsupported metadata type: ${def.type}.`);
	if (def.multiple && ['table', 'boolean'].includes(def.type))
		throw new UserError('Table and boolean fields cannot be multiple.');
	if (value === null) return null;
	if (def.multiple) {
		if (!Array.isArray(value)) throw new UserError('This metadata field requires an array.');
		return value.map((v) => scalar(def, v));
	}
	if (Array.isArray(value)) throw new UserError('This metadata field accepts only one value.');
	return scalar(def, value);
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (object(value))
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	return JSON.stringify(value) ?? 'undefined';
}
export function readbackValues(data: unknown, uid: string): unknown[] {
	return collection(data)
		.filter((row) => row.metaUid === uid || (object(row.meta) && row.meta.uid === uid))
		.map((row) => row.value);
}
export function verifyReadback(expected: Value, values: unknown[], def: Definition): boolean {
	if (expected === null) return !values.length || values.every((v) => v === null);
	try {
		if (def.multiple) {
			const flat = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
			const actual = validateTypedValue(def, flat) as Value[];
			return (
				canonical((expected as Value[]).map(canonical).sort()) ===
				canonical(actual.map(canonical).sort())
			);
		}
		return (
			values.length === 1 && canonical(expected) === canonical(validateTypedValue(def, values[0]))
		);
	} catch {
		return false;
	}
}
export async function executeMetadata(
	context: IExecuteFunctions,
	account: string,
	operation: string,
	index: number,
): Promise<IDataObject[]> {
	if (operation === 'getFields') return definitions(context, account);
	const record = validateUid(context.getNodeParameter('recordUid', index) as string);
	const path = `/entities/${record}/meta`;
	if (operation === 'get') return collection(await request(context, account, 'GET', path));
	if (operation !== 'update') throw new UserError('Unsupported metadata operation.');
	const uid = validateUid(context.getNodeParameter('metadataUid', index) as string);
	let def = (await request(context, account, 'GET', `/meta/${uid}`)) as Definition;
	if (!def || def.uid !== uid)
		throw new UserError('Metadata definition did not match the selected UID.');
	if (def.type === 'table' && !def.data?.table?.columns && !def.columns) {
		const catalog = (await definitions(context, account)).find((r) => r.uid === uid) as unknown as
			| Definition
			| undefined;
		if (!catalog) throw new UserError('Table schema could not be resolved.');
		def = {
			...catalog,
			...def,
			data: def.data ?? catalog.data,
			columns: def.columns ?? catalog.columns,
		};
	}
	if (def.permissions?.canUpdate === false)
		throw new UserError('Folderit denies permission to update this metadata field.');
	const mode = context.getNodeParameter('valueInput', index, 'json') as string;
	let raw: unknown;
	if (mode === 'clear') raw = null;
	else if (mode === 'select') {
		if (def.type !== 'select' || def.multiple)
			throw new UserError('Select Option input requires a single-value select field.');
		raw = context.getNodeParameter('selectOptionUid', index);
	} else if (mode === 'json') {
		raw = context.getNodeParameter('valueJson', index);
		if (typeof raw === 'string') {
			try {
				raw = JSON.parse(raw);
			} catch {
				throw new NodeOperationError(
					context.getNode(),
					'Enter valid JSON. Quote text values, for example "Approved".',
					{ itemIndex: index },
				);
			}
		}
	} else throw new UserError('Unsupported metadata value input.');
	const value = validateTypedValue(def, raw);
	const lock = String(context.getNodeParameter('fileLockId', index, '')).trim();
	if (lock.length > 2048 || /[\r\n]/.test(lock)) throw new UserError('File Lock ID is invalid.');
	const before = readbackValues(await request(context, account, 'GET', path), uid);
	const changed = !verifyReadback(value, before, def);
	if (changed) {
		await request(
			context,
			account,
			'PUT',
			path,
			{ fields: [{ metaUid: uid, value }] },
			undefined,
			lock ? { 'X-Folderit-Lock': lock } : undefined,
		);
		let after: unknown[];
		try {
			after = readbackValues(await request(context, account, 'GET', path), uid);
		} catch {
			throw new NodeOperationError(
				context.getNode(),
				'Metadata was submitted but readback failed. Inspect the record before retrying; the write was not repeated.',
				{ itemIndex: index },
			);
		}
		if (!verifyReadback(value, after, def))
			throw new UserError(
				'Metadata was submitted but readback did not match. Inspect the record before retrying; the write was not repeated.',
			);
	}
	return [
		{
			recordUid: record,
			metadataUid: uid,
			metadataName: def.name ?? uid,
			metadataType: def.type,
			multiple: !!def.multiple,
			value,
			changed,
			verified: true,
		},
	];
}
