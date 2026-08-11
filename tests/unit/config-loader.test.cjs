const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ConfigLoader } = require('../../dist/config/config-loader.js');

test('persists validated user settings and reloads them', async () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semlix-config-'));
    try {
        const archivePath = path.join(testRoot, 'mail archive');
        const userDataPath = path.join(testRoot, 'user data');
        fs.mkdirSync(archivePath, { recursive: true });

        const loader = new ConfigLoader();
        loader.initialize(userDataPath);
        assert.equal(loader.requiresPathSelection(), true);
        assert.equal(loader.getPathSelectionReason(), 'first-run');

        const initialDraft = loader.getDraft();
        assert.equal(initialDraft.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
        assert.equal(initialDraft.semanticSearch.reranking.enabled, false);
        assert.equal(initialDraft.semanticSearch.modelCacheDir, path.join(userDataPath, 'models'));
        const saved = loader.save({
            ...initialDraft,
            path: archivePath,
            timezone: 'UTC',
            semanticSearch: {
                ...initialDraft.semanticSearch,
                embedding: {
                    ...initialDraft.semanticSearch.embedding,
                    model: 'onnx-community/Qwen3-Embedding-4B-ONNX',
                    options: {
                        device: 'webgpu',
                        dtype: 'fp32'
                    }
                },
                reranking: {
                    ...initialDraft.semanticSearch.reranking,
                    enabled: true,
                    options: {
                        device: 'cpu',
                        dtype: 'q4'
                    }
                },
                topK: 30,
                rerankTopK: 20,
                finalTopK: 12
            }
        });

        assert.equal(saved.path, archivePath);
        assert.equal(saved.timezone, 'UTC');
        assert.equal(saved.semanticSearch.embedding.model, 'onnx-community/Qwen3-Embedding-4B-ONNX');
        assert.equal(saved.semanticSearch.embedding.options.device, 'webgpu');
        assert.equal(saved.semanticSearch.embedding.options.dtype, 'fp32');
        assert.equal(saved.semanticSearch.reranking.enabled, true);
        assert.equal(loader.requiresPathSelection(), false);
        assert.equal(loader.getPathSelectionReason(), null);

        const secondSave = loader.save({ ...saved, timezone: 'Europe/London' });
        assert.equal(secondSave.timezone, 'Europe/London');

        const reloaded = new ConfigLoader();
        reloaded.initialize(userDataPath);
        assert.deepEqual(await reloaded.load(), secondSave);

        fs.rmSync(archivePath, { recursive: true });
        assert.equal(reloaded.requiresPathSelection(), true);
        assert.equal(reloaded.getPathSelectionReason(), 'invalid-path');
    } finally {
        fs.rmSync(testRoot, { recursive: true, force: true });
    }
});

test('rejects invalid ranking relationships', () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semlix-config-'));
    try {
        const archivePath = path.join(testRoot, 'mail');
        fs.mkdirSync(archivePath);

        const loader = new ConfigLoader();
        loader.initialize(path.join(testRoot, 'user data'));
        const draft = loader.getDraft();

        assert.throws(
            () => loader.save({
                ...draft,
                path: archivePath,
                semanticSearch: {
                    ...draft.semanticSearch,
                    topK: 10,
                    rerankTopK: 11
                }
            }),
            /rerankTopK cannot be greater than topK/
        );
    } finally {
        fs.rmSync(testRoot, { recursive: true, force: true });
    }
});
