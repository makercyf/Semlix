const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractAll } = require('@electron/asar');

const applicationRootArgument = process.argv[2];
if (!applicationRootArgument) {
	throw new Error('Expected the unpacked application root as the first argument.');
}
const applicationRoot = path.resolve(applicationRootArgument);

const resourcesDirectories = [
	path.join(applicationRoot, 'resources'),
	path.join(applicationRoot, 'Contents', 'Resources')
];
const resourcesDirectory = resourcesDirectories.find((candidate) =>
	fs.existsSync(path.join(candidate, 'app.asar'))
);
if (!resourcesDirectory) {
	throw new Error(`Packaged application resources were not found under: ${applicationRoot}`);
}

const temporaryDirectory = process.env.SEMLIX_VERIFY_TEMP_DIR
	? path.resolve(process.env.SEMLIX_VERIFY_TEMP_DIR)
	: fs.mkdtempSync(path.join(os.tmpdir(), 'semlix-runtime-'));
const externallyManagedTemporaryDirectory = Boolean(process.env.SEMLIX_VERIFY_TEMP_DIR);
let store;
try {
	const extractedAppDirectory = path.join(temporaryDirectory, 'app');
	extractAll(path.join(resourcesDirectory, 'app.asar'), extractedAppDirectory);

	const unpackedDirectory = path.join(resourcesDirectory, 'app.asar.unpacked');
	if (fs.existsSync(unpackedDirectory)) {
		fs.cpSync(unpackedDirectory, extractedAppDirectory, { recursive: true });
	}

	const { VectorStore } = require(path.join(
		extractedAppDirectory,
		'dist',
		'db',
		'vector-store.js'
	));
	const {
		QWEN3_EMBEDDING_MODEL,
		QWEN3_RERANKER_MODEL
	} = require(path.join(
		extractedAppDirectory,
		'dist',
		'models',
		'qwen3-models.js'
	));

	store = new VectorStore(path.join(temporaryDirectory, 'verify.sqlite'), {
		embedding: {
			provider: 'transformers-js',
			model: QWEN3_EMBEDDING_MODEL,
			options: {
				device: 'cpu',
				dtype: 'q4'
			}
		},
		reranking: {
			enabled: false,
			provider: 'transformers-js',
			model: QWEN3_RERANKER_MODEL,
			options: {
				device: 'cpu',
				dtype: 'q4'
			}
		},
		topK: 20,
		rerankTopK: 20,
		finalTopK: 10
	});
	const range = store.getIndexedYearRange();
	if (range !== null) {
		throw new Error('A new packaged-runtime test database must have an empty date range.');
	}
	console.log('Packaged date-range runtime ready.');
} finally {
	store?.close();
	if (!externallyManagedTemporaryDirectory) {
		fs.rmSync(temporaryDirectory, { recursive: true });
	}
}
