import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { EmailData, IndexedYearRange, SearchCriteria, SemanticSearchConfig } from '../types';
import { getSearchableText } from '../email/email-parser';
import { parseDateStartMs, parseDateEndMs } from '../search/date-range';
import { loadSqliteVec } from './sqlite-extension';
import { getEmbeddingProfile } from '../models/embedding-profile';
import { getEmbeddingDimensions } from '../models/qwen3-models';

interface EmailRow {
	id: number;
	source_type: string;
	source_id: string;
	name: string;
	address: string;
	subject: string;
	date_timestamp: number;
	date_formatted: string;
	attachment: 'Yes' | 'No';
	attachment_filenames: string;
	path: string;
	text_content: string;
	html_content: string;
}

interface SearchRow extends EmailRow {
	distance: number;
}

interface ExistingEmailRow {
	id: number;
	sender_id: number;
	date_timestamp: number;
	date_formatted: string;
}

interface VectorCandidateRow {
	chunk_id: number | bigint;
	email_id: number | bigint;
	sender_id: number | bigint;
	year: number | bigint;
	date_timestamp: number | bigint;
	distance: number;
}

interface ResolvedSemanticFilters {
	senderIds: number[] | null;
	partitions: VectorDatePartition[] | null;
}

export interface ChunkEmbedding {
	text: string;
	vector: number[];
}

export interface VectorDatePartition {
	year: number;
	startTimestamp?: number;
	endTimestamp?: number;
}

export interface VectorKnnQuery {
	queryVector: number[];
	senderId?: number;
	partition?: VectorDatePartition;
	k: number;
}

export interface VectorCandidate {
	chunkId: number;
	emailId: number;
	senderId: number;
	year: number;
	dateTimestamp: number;
	distance: number;
}

export class VectorStore {
	private readonly db: Database.Database;
	private readonly embeddingDimensions: number;
	private readonly exactKnnStatements = new Map<string, Database.Statement>();

	constructor(dbPath: string, private readonly semanticConfig: SemanticSearchConfig) {
		this.embeddingDimensions = getEmbeddingDimensions(semanticConfig.embedding.model);
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		loadSqliteVec(this.db);
		this.db.pragma('foreign_keys = ON');
		this.db.pragma('journal_mode = WAL');
		this.db.pragma('busy_timeout = 5000');
		this.ensureSchema();
	}

	close(): void {
		this.exactKnnStatements.clear();
		this.db.close();
	}

	upsertEmail(email: EmailData, chunks: ChunkEmbedding[] = []): boolean {
		const sourceType = email.sourceType || 'eml';
		const sourceId = email.sourceId || email.path;
		const hash = this.contentHash(email);
		const existing = this.db.prepare(`
			SELECT id, sender_id, date_timestamp, date_formatted FROM emails
			WHERE source_type = ? AND source_id = ? AND content_hash = ?
		`).get(sourceType, sourceId, hash) as ExistingEmailRow | undefined;

		if (existing) {
			if (chunks.length === 0) return false;

			const existingChunkCount = this.db.prepare(`
				SELECT COUNT(*) AS count FROM email_chunks WHERE email_id = ?
			`).get(existing.id) as { count: number };
			const existingVectorCount = this.db.prepare(`
				SELECT COUNT(*) AS count FROM vec_email_chunks WHERE email_id = ?
			`).get(BigInt(existing.id)) as { count: number };

			if (
				existingChunkCount.count === chunks.length
				&& existingVectorCount.count === chunks.length
			) return false;

			this.db.transaction(() => this.replaceEmailChunks(
				existing.id,
				existing.sender_id,
				existing.date_timestamp,
				existing.date_formatted,
				chunks
			))();
			return true;
		}

		this.db.transaction(() => {
			const previous = this.db.prepare(`
				SELECT id FROM emails WHERE source_type = ? AND source_id = ?
			`).get(sourceType, sourceId) as { id: number } | undefined;

			if (previous) this.deleteEmailById(previous.id);
			const senderId = this.resolveOrInsertSender(email.name, email.address);

			const inserted = this.db.prepare(`
				INSERT INTO emails (
					source_type, source_id, sender_id, name, address, subject, date_timestamp, date_formatted,
					attachment, attachment_filenames, path, text_content, html_content, content_hash, indexed_at
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				sourceType,
				sourceId,
				senderId,
				email.name,
				email.address,
				email.subject,
				email.date.timestamp,
				email.date.formatted,
				email.attachment,
				JSON.stringify(email.attachmentFilenames),
				email.path,
				email.textContent || '',
				email.htmlContent || '',
				hash,
				Date.now()
			);

			const emailId = Number(inserted.lastInsertRowid);
			this.upsertFts(emailId, email);

			if (chunks.length > 0) {
				this.replaceEmailChunks(
					emailId,
					senderId,
					email.date.timestamp,
					email.date.formatted,
					chunks
				);
			}
		})();

		return true;
	}

	clearSqlDatabase(): void {
		this.db.exec(`
			DELETE FROM vec_email_chunks;
			DELETE FROM email_chunks;
			DELETE FROM email_search_fts;
			DELETE FROM emails;
			DELETE FROM senders;
		`);
	}

	clearVectorDatabase(): void {
		this.db.exec('DELETE FROM vec_email_chunks;');
	}

	searchKeyword(criteria: SearchCriteria): EmailData[] {
		const { whereClause, params } = this.buildFilterWhere(criteria);
		const keyword = criteria.keyword.trim();
		const keywordClause = keyword ? this.buildKeywordWhere(keyword) : { clause: '', params: [] };
		const whereParts = [whereClause.replace(/^WHERE\s+/, ''), keywordClause.clause].filter(Boolean);
		const rows = this.db.prepare(`
			SELECT emails.*
			FROM emails
			${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
			ORDER BY emails.date_timestamp DESC
		`).all(...params, ...keywordClause.params) as EmailRow[];

		return rows.map(row => this.rowToEmail(row));
	}

	searchSemantic(
		queryVector: number[],
		criteria: SearchCriteria,
		limit: number
	): EmailData[] {
		validatePositiveInteger(limit, 'Semantic candidate count');
		const filters = this.resolveSemanticFilters(criteria);
		if (filters.senderIds?.length === 0 || filters.partitions?.length === 0) return [];

		const senderIds: Array<number | undefined> = filters.senderIds ?? [undefined];
		const partitions: Array<VectorDatePartition | undefined> = filters.partitions ?? [undefined];
		const candidateSets: VectorCandidate[][] = [];

		for (const senderId of senderIds) {
			for (const partition of partitions) {
				candidateSets.push(this.queryDistinctEmailCandidates({
					queryVector,
					senderId,
					partition,
					k: limit
				}));
			}
		}

		const candidates = mergeCandidatesByEmail(candidateSets, limit);
		const selectEmail = this.db.prepare('SELECT * FROM emails WHERE id = ?');
		return candidates.flatMap(candidate => {
			const row = selectEmail.get(candidate.emailId) as EmailRow | undefined;
			if (!row) return [];
			return [this.rowToEmail({ ...row, distance: candidate.distance })];
		});
	}

	listEmails(): EmailData[] {
		const rows = this.db.prepare('SELECT * FROM emails ORDER BY date_timestamp DESC').all() as EmailRow[];
		return rows.map(row => this.rowToEmail(row));
	}

	getIndexedYearRange(): IndexedYearRange | null {
		const first = this.db.prepare(`
			SELECT date_formatted FROM emails
			ORDER BY date_timestamp ASC, id ASC
			LIMIT 1
		`).get() as { date_formatted: string } | undefined;
		const last = this.db.prepare(`
			SELECT date_formatted FROM emails
			ORDER BY date_timestamp DESC, id DESC
			LIMIT 1
		`).get() as { date_formatted: string } | undefined;

		if (!first || !last) return null;
		const fromYear = extractFormattedYear(first.date_formatted);
		const toYear = extractFormattedYear(last.date_formatted);
		return fromYear && toYear ? { fromYear, toYear } : null;
	}

	resolveSenderIds(senderSubstring: string): number[] {
		const normalizedSubstring = normalizeSenderValue(senderSubstring);
		if (!normalizedSubstring) return [];

		const pattern = `%${normalizedSubstring}%`;
		const rows = this.db.prepare(`
			SELECT id
			FROM senders
			WHERE normalized_name LIKE ?
				OR normalized_address LIKE ?
			ORDER BY id ASC
		`).all(pattern, pattern) as Array<{ id: number }>;

		return rows.map(row => row.id);
	}

	queryVec0ExactKnn(query: VectorKnnQuery): VectorCandidate[] {
		validatePositiveInteger(query.k, 'KNN candidate count');
		if (query.senderId !== undefined) {
			validatePositiveInteger(query.senderId, 'Sender ID');
		}
		if (query.partition) {
			validateInteger(query.partition.year, 'Partition year');
			if (query.partition.startTimestamp !== undefined) {
				validateInteger(query.partition.startTimestamp, 'Partition start timestamp');
			}
			if (query.partition.endTimestamp !== undefined) {
				validateInteger(query.partition.endTimestamp, 'Partition end timestamp');
			}
			if (
				query.partition.startTimestamp !== undefined
				&& query.partition.endTimestamp !== undefined
				&& query.partition.startTimestamp > query.partition.endTimestamp
			) {
				throw new Error('Partition start timestamp must not be after its end timestamp.');
			}
		}

		const statement = this.getExactKnnStatement(query);
		const params: Array<Buffer | number | bigint> = [this.serializeVector(query.queryVector)];
		if (query.senderId !== undefined) params.push(BigInt(query.senderId));
		if (query.partition) {
			params.push(BigInt(query.partition.year));
			if (query.partition.startTimestamp !== undefined) {
				params.push(BigInt(query.partition.startTimestamp));
			}
			if (query.partition.endTimestamp !== undefined) {
				params.push(BigInt(query.partition.endTimestamp));
			}
		}
		params.push(query.k);

		const rows = statement.all(...params) as VectorCandidateRow[];
		return rows.map(row => ({
			chunkId: Number(row.chunk_id),
			emailId: Number(row.email_id),
			senderId: Number(row.sender_id),
			year: Number(row.year),
			dateTimestamp: Number(row.date_timestamp),
			distance: row.distance
		})).sort((left, right) =>
			left.distance - right.distance
			|| left.chunkId - right.chunkId
		);
	}

	private queryDistinctEmailCandidates(query: VectorKnnQuery): VectorCandidate[] {
		let k = query.k;

		while (true) {
			const chunks = this.queryVec0ExactKnn({ ...query, k });
			const emails = mergeCandidatesByEmail([chunks], query.k);

			if (emails.length >= query.k || chunks.length < k) return emails;

			const nextK = Math.min(k * 2, Number.MAX_SAFE_INTEGER);
			if (nextK === k) return emails;
			k = nextK;
		}
	}

	private resolveSemanticFilters(criteria: SearchCriteria): ResolvedSemanticFilters {
		const senderIds = criteria.sender.trim()
			? this.resolveSenderIds(criteria.sender)
			: null;
		const partitions = this.resolveDatePartitions(criteria.dateFrom, criteria.dateTo);
		return { senderIds, partitions };
	}

	private resolveDatePartitions(dateFrom?: string, dateTo?: string): VectorDatePartition[] | null {
		const fromMs = parseDateStartMs(dateFrom);
		const toMs = parseDateEndMs(dateTo);
		if (fromMs === null && toMs === null) return null;

		const startTimestamp = fromMs === null ? undefined : Math.floor(fromMs / 1000);
		const endTimestamp = toMs === null ? undefined : Math.floor(toMs / 1000);
		if (
			startTimestamp !== undefined
			&& endTimestamp !== undefined
			&& startTimestamp > endTimestamp
		) return [];

		const constraints: string[] = [];
		const params: number[] = [];
		if (startTimestamp !== undefined) {
			constraints.push('date_timestamp >= ?');
			params.push(startTimestamp);
		}
		if (endTimestamp !== undefined) {
			constraints.push('date_timestamp <= ?');
			params.push(endTimestamp);
		}

		const rows = this.db.prepare(`
			SELECT DISTINCT CAST(SUBSTR(date_formatted, 1, 4) AS INTEGER) AS year
			FROM emails
			WHERE ${constraints.join(' AND ')}
			ORDER BY year ASC
		`).all(...params) as Array<{ year: number }>;

		return rows.map(row => ({
			year: row.year,
			startTimestamp,
			endTimestamp
		}));
	}

	private ensureSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS app_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS senders (
				id INTEGER PRIMARY KEY,
				identity_key TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL DEFAULT '',
				address TEXT NOT NULL DEFAULT '',
				normalized_name TEXT NOT NULL DEFAULT '',
				normalized_address TEXT NOT NULL DEFAULT ''
			);

			CREATE INDEX IF NOT EXISTS idx_senders_normalized_name
			ON senders(normalized_name);

			CREATE INDEX IF NOT EXISTS idx_senders_normalized_address
			ON senders(normalized_address);

			CREATE TABLE IF NOT EXISTS emails (
				id INTEGER PRIMARY KEY,
				source_type TEXT NOT NULL,
				source_id TEXT NOT NULL,
				sender_id INTEGER NOT NULL,
				name TEXT NOT NULL,
				address TEXT NOT NULL,
				subject TEXT NOT NULL,
				date_timestamp INTEGER NOT NULL,
				date_formatted TEXT NOT NULL,
				attachment TEXT NOT NULL,
				attachment_filenames TEXT NOT NULL,
				path TEXT NOT NULL,
				text_content TEXT NOT NULL,
				html_content TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				indexed_at INTEGER NOT NULL,
				UNIQUE(source_type, source_id),
				FOREIGN KEY(sender_id) REFERENCES senders(id)
			);

			CREATE INDEX IF NOT EXISTS idx_emails_sender_id
			ON emails(sender_id);

			CREATE TABLE IF NOT EXISTS email_chunks (
				id INTEGER PRIMARY KEY,
				email_id INTEGER NOT NULL,
				chunk_index INTEGER NOT NULL,
				chunk_text TEXT NOT NULL,
				FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_email_chunks_email_id
			ON email_chunks(email_id);

			CREATE VIRTUAL TABLE IF NOT EXISTS email_search_fts USING fts5(
				name,
				address,
				subject,
				body,
				attachment_filenames
			);
		`);

		this.synchronizeEmbeddingProfile();
	}

	private synchronizeEmbeddingProfile(): void {
		const dim = this.embeddingDimensions.toString();
		const profile = getEmbeddingProfile(this.semanticConfig);
		const dimensionRow = this.db.prepare("SELECT value FROM app_meta WHERE key = 'embeddingDimensions'")
			.get() as { value: string } | undefined;
		const profileRow = this.db.prepare("SELECT value FROM app_meta WHERE key = 'embeddingProfile'")
			.get() as { value: string } | undefined;
		const dimensionsChanged = dimensionRow !== undefined && dimensionRow.value !== dim;
		const profileChanged = profileRow !== undefined && profileRow.value !== profile;

		if (dimensionsChanged || profileChanged) {
			this.db.exec('DROP TABLE IF EXISTS vec_email_chunks;');
		}

		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS vec_email_chunks USING vec0(
				chunk_id INTEGER PRIMARY KEY,
				email_id INTEGER,
				sender_id INTEGER,
				year INTEGER PARTITION KEY,
				date_timestamp INTEGER,
				chunk_embedding float[${this.embeddingDimensions}] distance_metric=cosine
			);
		`);

		this.db.prepare(`
			INSERT INTO app_meta (key, value)
			VALUES ('embeddingDimensions', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`).run(dim);
		this.db.prepare(`
			INSERT INTO app_meta (key, value)
			VALUES ('embeddingProfile', ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`).run(profile);
	}

	private getExactKnnStatement(query: VectorKnnQuery): Database.Statement {
		const hasSender = query.senderId !== undefined;
		const hasPartition = query.partition !== undefined;
		const hasStart = query.partition?.startTimestamp !== undefined;
		const hasEnd = query.partition?.endTimestamp !== undefined;
		const cacheKey = [hasSender, hasPartition, hasStart, hasEnd]
			.map(value => value ? '1' : '0')
			.join('');
		const cached = this.exactKnnStatements.get(cacheKey);
		if (cached) return cached;

		const constraints = ['chunk_embedding MATCH ?'];
		if (hasSender) constraints.push('sender_id = ?');
		if (hasPartition) constraints.push('year = ?');
		if (hasStart) constraints.push('date_timestamp >= ?');
		if (hasEnd) constraints.push('date_timestamp <= ?');
		constraints.push('k = ?');

		const statement = this.db.prepare(`
			SELECT
				chunk_id,
				email_id,
				sender_id,
				year,
				date_timestamp,
				distance
			FROM vec_email_chunks
			WHERE ${constraints.join('\n\t\t\t\tAND ')}
			ORDER BY distance ASC
		`);
		this.exactKnnStatements.set(cacheKey, statement);
		return statement;
	}

	private deleteEmailById(id: number): void {
		const email = this.db.prepare('SELECT sender_id FROM emails WHERE id = ?')
			.get(id) as { sender_id: number } | undefined;
		this.db.prepare('DELETE FROM vec_email_chunks WHERE email_id = ?').run(BigInt(id));
		this.db.prepare('DELETE FROM email_chunks WHERE email_id = ?').run(id);
		this.db.prepare('DELETE FROM email_search_fts WHERE rowid = ?').run(id);
		this.db.prepare('DELETE FROM emails WHERE id = ?').run(id);
		if (email) {
			this.db.prepare(`
				DELETE FROM senders
				WHERE id = ?
					AND NOT EXISTS (SELECT 1 FROM emails WHERE sender_id = ?)
			`).run(email.sender_id, email.sender_id);
		}
	}

	private resolveOrInsertSender(name: string, address: string): number {
		const normalizedName = normalizeSenderValue(name);
		const normalizedAddress = normalizeSenderValue(address);
		const identityKey = buildSenderIdentityKey(normalizedName, normalizedAddress);
		const existing = this.db.prepare('SELECT id FROM senders WHERE identity_key = ?')
			.get(identityKey) as { id: number } | undefined;

		if (existing) {
			this.db.prepare(`
				UPDATE senders
				SET name = ?, address = ?, normalized_name = ?, normalized_address = ?
				WHERE id = ?
			`).run(name, address, normalizedName, normalizedAddress, existing.id);
			return existing.id;
		}

		const inserted = this.db.prepare(`
			INSERT INTO senders (
				identity_key, name, address, normalized_name, normalized_address
			)
			VALUES (?, ?, ?, ?, ?)
		`).run(identityKey, name, address, normalizedName, normalizedAddress);

		return Number(inserted.lastInsertRowid);
	}

	private upsertFts(emailId: number, email: EmailData): void {
		this.db.prepare('DELETE FROM email_search_fts WHERE rowid = ?').run(emailId);
		this.db.prepare(`
			INSERT INTO email_search_fts(rowid, name, address, subject, body, attachment_filenames)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(
			emailId,
			email.name,
			email.address,
			email.subject,
			[email.textContent || '', email.htmlContent || ''].join('\n'),
			email.attachmentFilenames.join('\n')
		);
	}

	private replaceEmailChunks(
		emailId: number,
		senderId: number,
		dateTimestamp: number,
		dateFormatted: string,
		chunks: ChunkEmbedding[]
	): void {
		this.db.prepare('DELETE FROM vec_email_chunks WHERE email_id = ?').run(BigInt(emailId));
		this.db.prepare('DELETE FROM email_chunks WHERE email_id = ?').run(emailId);

		const insertChunk = this.db.prepare(`
			INSERT INTO email_chunks (email_id, chunk_index, chunk_text)
			VALUES (?, ?, ?)
		`);
		const insertVector = this.db.prepare(`
			INSERT INTO vec_email_chunks(
				chunk_id, email_id, sender_id, year, date_timestamp, chunk_embedding
			)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
		const year = resolveVectorYear(dateFormatted, dateTimestamp);

		chunks.forEach((chunk, index) => {
			const embedding = this.serializeVector(chunk.vector);
			const chunkRow = insertChunk.run(emailId, index, chunk.text);
			insertVector.run(
				BigInt(chunkRow.lastInsertRowid),
				BigInt(emailId),
				BigInt(senderId),
				BigInt(year),
				BigInt(dateTimestamp),
				embedding
			);
		});
	}

	private rowToEmail(row: EmailRow | SearchRow): EmailData {
		const email: EmailData = {
			id: row.id,
			sourceType: row.source_type as EmailData['sourceType'],
			sourceId: row.source_id,
			name: row.name,
			address: row.address,
			subject: row.subject,
			date: {
				timestamp: row.date_timestamp,
				formatted: row.date_formatted
			},
			attachment: row.attachment,
			attachmentFilenames: JSON.parse(row.attachment_filenames) as string[],
			path: row.path,
			textContent: row.text_content,
			htmlContent: row.html_content
		};

		if ('distance' in row) {
			email.relevance = Number.isFinite(row.distance) ? 1 / (1 + row.distance) : undefined;
		}

		return email;
	}

	private serializeVector(vector: number[]): Buffer {
		if (vector.length !== this.embeddingDimensions) {
			throw new Error(`Embedding dimension mismatch. Expected ${this.embeddingDimensions}, received ${vector.length}.`);
		}
		return Buffer.from(new Float32Array(vector).buffer);
	}

	private contentHash(email: EmailData): string {
		return crypto.createHash('sha256').update(getSearchableText(email)).digest('hex');
	}

	private buildFilterWhere(criteria: SearchCriteria): { whereClause: string; params: Array<string | number> } {
		const clauses: string[] = [];
		const params: Array<string | number> = [];

		if (criteria.sender.trim()) {
			clauses.push('(UPPER(emails.name) LIKE ? OR UPPER(emails.address) LIKE ?)');
			const sender = `%${criteria.sender.trim().toLocaleUpperCase()}%`;
			params.push(sender, sender);
		}

		const fromMs = parseDateStartMs(criteria.dateFrom);
		const toMs = parseDateEndMs(criteria.dateTo);
		if (fromMs !== null) {
			clauses.push('emails.date_timestamp >= ?');
			params.push(Math.floor(fromMs / 1000));
		}
		if (toMs !== null) {
			clauses.push('emails.date_timestamp <= ?');
			params.push(Math.floor(toMs / 1000));
		}

		return {
			whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
			params
		};
	}

	private buildKeywordWhere(keyword: string): { clause: string; params: Array<string> } {
		const like = `%${keyword.toLocaleUpperCase()}%`;
		const ftsQuery = buildFtsQuery(keyword);
		const likeClause = `(
			UPPER(emails.name) LIKE ?
			OR UPPER(emails.address) LIKE ?
			OR UPPER(emails.subject) LIKE ?
			OR UPPER(emails.text_content) LIKE ?
			OR UPPER(emails.html_content) LIKE ?
			OR UPPER(emails.attachment_filenames) LIKE ?
		)`;

		if (!ftsQuery) {
			return { clause: likeClause, params: [like, like, like, like, like, like] };
		}

		return {
			clause: `(
				emails.id IN (SELECT rowid FROM email_search_fts WHERE email_search_fts MATCH ?)
				OR ${likeClause}
			)`,
			params: [ftsQuery, like, like, like, like, like, like]
		};
	}
}

function extractFormattedYear(value: string): string | null {
	const match = /^(\d{4})\./.exec(value);
	return match?.[1] || null;
}

function normalizeSenderValue(value: string): string {
	return value.trim().toLocaleUpperCase();
}

function buildSenderIdentityKey(normalizedName: string, normalizedAddress: string): string {
	return JSON.stringify([normalizedName, normalizedAddress]);
}

function resolveVectorYear(dateFormatted: string, dateTimestamp: number): number {
	const formattedYear = extractFormattedYear(dateFormatted);
	if (formattedYear) return Number.parseInt(formattedYear, 10);

	return new Date(dateTimestamp * 1000).getUTCFullYear();
}

function validateInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${label} must be a safe integer.`);
	}
}

function validatePositiveInteger(value: number, label: string): void {
	validateInteger(value, label);
	if (value <= 0) {
		throw new Error(`${label} must be greater than zero.`);
	}
}

function mergeCandidatesByEmail(
	candidateSets: VectorCandidate[][],
	limit: number
): VectorCandidate[] {
	const bestByEmail = new Map<number, VectorCandidate>();

	for (const candidates of candidateSets) {
		for (const candidate of candidates) {
			const existing = bestByEmail.get(candidate.emailId);
			if (
				!existing
				|| candidate.distance < existing.distance
				|| (
					candidate.distance === existing.distance
					&& candidate.chunkId < existing.chunkId
				)
			) {
				bestByEmail.set(candidate.emailId, candidate);
			}
		}
	}

	return [...bestByEmail.values()]
		.sort((left, right) =>
			left.distance - right.distance
			|| left.emailId - right.emailId
			|| left.chunkId - right.chunkId
		)
		.slice(0, limit);
}

function buildFtsQuery(keyword: string): string {
	return keyword
		.split(/\s+/)
		.map(term => term.replace(/"/g, '""').trim())
		.filter(Boolean)
		.map(term => `"${term}"`)
		.join(' AND ');
}
