const assert = require('node:assert/strict');
const test = require('node:test');
const { VectorStore } = require('../../dist/db/vector-store.js');

const EMBEDDING_DIMENSIONS = 1024;
const QUERY_VALUES = [1, 0];

const semanticConfig = {
	embedding: {
		provider: 'transformers-js',
		model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
		options: { device: 'cpu', dtype: 'q4' }
	},
	reranking: {
		enabled: false,
		provider: 'transformers-js',
		model: 'onnx-community/Qwen3-Reranker-0.6B-ONNX',
		options: { device: 'cpu', dtype: 'q4' }
	},
	topK: 20,
	rerankTopK: 20,
	finalTopK: 10
};

const emailDefinitions = [
	{
		sourceId: 'smith-2024', name: 'John Smith', address: 'john.smith@example.com',
		date: '2024-12-15T12:00:00Z', formatted: '2024.12.15 Sun 12.00.00',
		vectors: [[1, 0], [0.98, 0.02]]
	},
	{
		sourceId: 'smith-2025', name: 'John Smith', address: 'john.smith@example.com',
		date: '2025-01-05T12:00:00Z', formatted: '2025.01.05 Sun 12.00.00',
		vectors: [[0.8, 0.2]]
	},
	{
		sourceId: 'lennon-2025-feb', name: 'John Lennon', address: 'john.lennon@example.com',
		date: '2025-02-10T12:00:00Z', formatted: '2025.02.10 Mon 12.00.00',
		vectors: [[0.9, 0.1]]
	},
	{
		sourceId: 'lennon-2025-apr', name: 'John Lennon', address: 'john.lennon@example.com',
		date: '2025-04-10T12:00:00Z', formatted: '2025.04.10 Thu 12.00.00',
		vectors: [[0.2, 0.8]]
	},
	{
		sourceId: 'alice-2025', name: 'Alice Wong', address: 'alice@example.com',
		date: '2025-01-20T12:00:00Z', formatted: '2025.01.20 Mon 12.00.00',
		vectors: [[0.95, 0.05]]
	},
	{
		sourceId: 'smith-2026', name: 'John Smith', address: 'john.smith@example.com',
		date: '2026-03-01T12:00:00Z', formatted: '2026.03.01 Sun 12.00.00',
		vectors: [[0.6, 0.4]]
	}
];

test('stores each embedding once with complete vector metadata', () => {
	const fixture = createFixture();
	try {
		const chunkColumns = fixture.db.prepare('PRAGMA table_info(email_chunks)')
			.all()
			.map(row => row.name);
		assert.deepEqual(chunkColumns, ['id', 'email_id', 'chunk_index', 'chunk_text']);

		const vectorRows = fixture.db.prepare(`
			SELECT chunk_id, email_id, sender_id, year, date_timestamp,
				LENGTH(chunk_embedding) AS vector_bytes
			FROM vec_email_chunks
			ORDER BY chunk_id
		`).all();
		assert.equal(vectorRows.length, fixture.chunks.length);
		assert.equal(
			fixture.db.prepare('SELECT COUNT(*) AS count FROM email_chunks').get().count,
			fixture.chunks.length
		);
		assert.equal(new Set(vectorRows.map(row => Number(row.chunk_id))).size, fixture.chunks.length);
		for (const row of vectorRows) {
			const expected = fixture.chunks.find(chunk => chunk.chunkId === Number(row.chunk_id));
			assert.ok(expected);
			assert.equal(Number(row.email_id), expected.emailId);
			assert.equal(Number(row.sender_id), expected.senderId);
			assert.equal(Number(row.year), expected.year);
			assert.equal(Number(row.date_timestamp), expected.dateTimestamp);
			assert.equal(row.vector_bytes, EMBEDDING_DIMENSIONS * 4);
		}
	} finally {
		fixture.store.close();
	}
});

test('resolves sender substrings using normalized sender rows', () => {
	const fixture = createFixture();
	try {
		assert.equal(fixture.store.resolveSenderIds('john').length, 2);
		assert.deepEqual(
			fixture.store.resolveSenderIds('LENNON@EXAMPLE.COM'),
			[fixture.senderIdByAddress.get('john.lennon@example.com')]
		);
		assert.deepEqual(
			fixture.store.resolveSenderIds('alice'),
			[fixture.senderIdByAddress.get('alice@example.com')]
		);
		assert.deepEqual(fixture.store.resolveSenderIds('nobody'), []);
	} finally {
		fixture.store.close();
	}
});

test('preserves historical sender names for the same address', () => {
	const store = new VectorStore(':memory:', semanticConfig);
	try {
		upsertDefinition(store, {
			sourceId: 'john-billing', name: 'John Smith', address: 'billing@example.com',
			date: '2025-01-01T12:00:00Z', formatted: '2025.01.01 Wed 12.00.00',
			vectors: [[1, 0]]
		});
		upsertDefinition(store, {
			sourceId: 'accounts-billing', name: 'Accounts Team', address: 'billing@example.com',
			date: '2025-01-02T12:00:00Z', formatted: '2025.01.02 Thu 12.00.00',
			vectors: [[0.9, 0.1]]
		});

		const johnIds = store.resolveSenderIds('john');
		const accountsIds = store.resolveSenderIds('accounts');
		assert.equal(johnIds.length, 1);
		assert.equal(accountsIds.length, 1);
		assert.notEqual(johnIds[0], accountsIds[0]);
		assert.deepEqual(
			new Set(store.resolveSenderIds('billing@example.com')),
			new Set([johnIds[0], accountsIds[0]])
		);
		assert.deepEqual(
			store.searchSemantic(
				paddedVector(QUERY_VALUES),
				{ keyword: 'query', sender: 'john', mode: 'semantic' },
				10
			).map(email => email.sourceId),
			['john-billing']
		);
	} finally {
		store.close();
	}
});

test('matches brute-force cosine ordering for an exact sender', () => {
	const fixture = createFixture();
	try {
		const senderId = fixture.senderIdByAddress.get('john.smith@example.com');
		const actual = fixture.store.queryVec0ExactKnn({
			queryVector: paddedVector(QUERY_VALUES), senderId, k: 20
		});
		const expected = bruteForceChunks(
			fixture.chunks.filter(chunk => chunk.senderId === senderId), 20
		);
		assert.deepEqual(actual.map(candidate => candidate.chunkId), expected.map(chunk => chunk.chunkId));
		assertDistances(actual, expected);
	} finally {
		fixture.store.close();
	}
});

test('matches brute-force cosine ordering for a year partition', () => {
	const fixture = createFixture();
	try {
		const actual = fixture.store.queryVec0ExactKnn({
			queryVector: paddedVector(QUERY_VALUES), partition: { year: 2025 }, k: 20
		});
		const expected = bruteForceChunks(
			fixture.chunks.filter(chunk => chunk.year === 2025), 20
		);
		assert.deepEqual(actual.map(candidate => candidate.chunkId), expected.map(chunk => chunk.chunkId));
		assertDistances(actual, expected);
	} finally {
		fixture.store.close();
	}
});

test('merges multiple senders and year partitions like brute force', () => {
	const fixture = createFixture();
	try {
		const criteria = {
			keyword: 'query', sender: 'john', mode: 'semantic',
			dateFrom: '2024-11-01', dateTo: '2025-02-28'
		};
		const actual = fixture.store.searchSemantic(paddedVector(QUERY_VALUES), criteria, 20);
		const senderIds = new Set(fixture.store.resolveSenderIds(criteria.sender));
		const startTimestamp = Math.floor(Date.parse(`${criteria.dateFrom}T00:00:00`) / 1000);
		const endTimestamp = Math.floor(Date.parse(`${criteria.dateTo}T23:59:59`) / 1000);
		const expected = bruteForceEmails(
			fixture.chunks.filter(chunk =>
				senderIds.has(chunk.senderId)
				&& chunk.dateTimestamp >= startTimestamp
				&& chunk.dateTimestamp <= endTimestamp
			),
			20
		);
		assert.deepEqual(
			actual.map(email => email.sourceId),
			expected.map(candidate => fixture.sourceIdByEmailId.get(candidate.emailId))
		);
	} finally {
		fixture.store.close();
	}
});

test('collapses duplicate chunks and preserves reranker candidate semantics', () => {
	const fixture = createFixture();
	try {
		const actual = fixture.store.searchSemantic(
			paddedVector(QUERY_VALUES),
			{ keyword: 'query', sender: '', mode: 'semantic' },
			20
		);
		const expected = bruteForceEmails(fixture.chunks, 20);
		assert.deepEqual(
			actual.map(email => email.sourceId),
			expected.map(candidate => fixture.sourceIdByEmailId.get(candidate.emailId))
		);
		assert.equal(actual.filter(email => email.sourceId === 'smith-2024').length, 1);
		for (let index = 0; index < actual.length; index++) {
			assert.equal(actual[index].textContent, actual[index].sourceId);
			assert.ok(Number.isFinite(actual[index].relevance));
			if (index > 0) assert.ok(actual[index - 1].relevance >= actual[index].relevance);
		}
	} finally {
		fixture.store.close();
	}
});

test('adaptively expands KNN until the exact top distinct emails are available', () => {
	const store = new VectorStore(':memory:', semanticConfig);
	try {
		const definitions = [
			{
				sourceId: 'email-a', name: 'A', address: 'a@example.com',
				date: '2025-01-01T12:00:00Z', formatted: '2025.01.01 Wed 12.00.00',
				vectors: [[1, 0], [1, 0.01], [1, 0.02], [1, 0.03], [1, 0.04]]
			},
			{
				sourceId: 'email-b', name: 'B', address: 'b@example.com',
				date: '2025-01-02T12:00:00Z', formatted: '2025.01.02 Thu 12.00.00',
				vectors: [[1, 0.1]]
			},
			{
				sourceId: 'email-c', name: 'C', address: 'c@example.com',
				date: '2025-01-03T12:00:00Z', formatted: '2025.01.03 Fri 12.00.00',
				vectors: [[1, 0.2]]
			},
			{
				sourceId: 'email-d', name: 'D', address: 'd@example.com',
				date: '2025-01-04T12:00:00Z', formatted: '2025.01.04 Sat 12.00.00',
				vectors: [[1, 0.3]]
			}
		];
		for (const definition of definitions) upsertDefinition(store, definition);

		const requestedKValues = [];
		const queryExactKnn = store.queryVec0ExactKnn.bind(store);
		store.queryVec0ExactKnn = query => {
			requestedKValues.push(query.k);
			return queryExactKnn(query);
		};
		const actual = store.searchSemantic(
			paddedVector(QUERY_VALUES),
			{ keyword: 'query', sender: '', mode: 'semantic' },
			3
		);

		assert.deepEqual(actual.map(email => email.sourceId), ['email-a', 'email-b', 'email-c']);
		assert.deepEqual(requestedKValues, [3, 6, 12]);
	} finally {
		store.close();
	}
});

test('executes every sender and partition combination with statement reuse', () => {
	const fixture = createFixture();
	try {
		const calls = [];
		const queryExactKnn = fixture.store.queryVec0ExactKnn.bind(fixture.store);
		fixture.store.queryVec0ExactKnn = query => {
			calls.push(query);
			return queryExactKnn(query);
		};

		fixture.store.searchSemantic(paddedVector(QUERY_VALUES), {
			keyword: 'query', sender: 'john', mode: 'semantic',
			dateFrom: '2024-11-01', dateTo: '2025-02-28'
		}, 20);

		assert.equal(calls.length, 4);
		assert.deepEqual(
			new Set(calls.map(call => call.senderId)),
			new Set(fixture.store.resolveSenderIds('john'))
		);
		assert.deepEqual(new Set(calls.map(call => call.partition.year)), new Set([2024, 2025]));
		assert.ok(calls.every(call => call.partition.startTimestamp !== undefined));
		assert.ok(calls.every(call => call.partition.endTimestamp !== undefined));
		assert.equal(fixture.store.exactKnnStatements.size, 1);
	} finally {
		fixture.store.close();
	}
});

function createFixture() {
	const store = new VectorStore(':memory:', semanticConfig);
	for (const definition of emailDefinitions) {
		upsertDefinition(store, definition);
	}

	const db = store.db;
	const indexedEmails = store.listEmails();
	const emailIdBySource = new Map(indexedEmails.map(email => [email.sourceId, email.id]));
	const sourceIdByEmailId = new Map(indexedEmails.map(email => [email.id, email.sourceId]));
	const senderIdByAddress = new Map();
	for (const definition of emailDefinitions) {
		if (!senderIdByAddress.has(definition.address)) {
			senderIdByAddress.set(definition.address, store.resolveSenderIds(definition.address)[0]);
		}
	}

	let chunkId = 1;
	const chunks = [];
	for (const definition of emailDefinitions) {
		for (const vector of definition.vectors) {
			chunks.push({
				chunkId,
				emailId: emailIdBySource.get(definition.sourceId),
				senderId: senderIdByAddress.get(definition.address),
				year: Number.parseInt(definition.formatted.slice(0, 4), 10),
				dateTimestamp: Math.floor(Date.parse(definition.date) / 1000),
				vector
			});
			chunkId++;
		}
	}

	return { store, db, chunks, senderIdByAddress, sourceIdByEmailId };
}

function upsertDefinition(store, definition) {
	store.upsertEmail({
		sourceType: 'eml', sourceId: definition.sourceId,
		name: definition.name, address: definition.address, subject: definition.sourceId,
		date: {
			timestamp: Math.floor(Date.parse(definition.date) / 1000),
			formatted: definition.formatted
		},
		attachment: 'No', attachmentFilenames: [], path: definition.sourceId,
		textContent: definition.sourceId, htmlContent: ''
	}, definition.vectors.map((vector, index) => ({
		text: `${definition.sourceId}-${index}`,
		vector: paddedVector(vector)
	})));
}

function paddedVector(values) {
	const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
	for (let index = 0; index < values.length; index++) vector[index] = values[index];
	return vector;
}

function cosineDistance(left, right) {
	let dotProduct = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const leftValue = left[index] || 0;
		const rightValue = right[index] || 0;
		dotProduct += leftValue * rightValue;
		leftNorm += leftValue * leftValue;
		rightNorm += rightValue * rightValue;
	}
	return 1 - dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function bruteForceChunks(chunks, limit) {
	return chunks
		.map(chunk => ({ ...chunk, distance: cosineDistance(QUERY_VALUES, chunk.vector) }))
		.sort((left, right) => left.distance - right.distance || left.chunkId - right.chunkId)
		.slice(0, limit);
}

function bruteForceEmails(chunks, limit) {
	const bestByEmail = new Map();
	for (const candidate of bruteForceChunks(chunks, chunks.length)) {
		if (!bestByEmail.has(candidate.emailId)) bestByEmail.set(candidate.emailId, candidate);
	}
	return [...bestByEmail.values()]
		.sort((left, right) =>
			left.distance - right.distance
			|| left.emailId - right.emailId
			|| left.chunkId - right.chunkId
		)
		.slice(0, limit);
}

function assertDistances(actual, expected) {
	assert.equal(actual.length, expected.length);
	for (let index = 0; index < actual.length; index++) {
		assert.ok(Math.abs(actual[index].distance - expected[index].distance) < 1e-6);
	}
}
