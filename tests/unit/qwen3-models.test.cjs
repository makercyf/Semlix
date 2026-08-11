const assert = require('node:assert/strict');
const test = require('node:test');

const {
    getEmbeddingDimensions,
    isSupportedEmbeddingModel,
    isSupportedRerankerModel
} = require('../../dist/models/qwen3-models.js');

test('derives dimensions for every supported Qwen3 embedding model', () => {
    assert.equal(getEmbeddingDimensions('onnx-community/Qwen3-Embedding-0.6B-ONNX'), 1024);
    assert.equal(getEmbeddingDimensions('onnx-community/Qwen3-Embedding-4B-ONNX'), 2560);
    assert.equal(getEmbeddingDimensions('onnx-community/Qwen3-Embedding-8B-ONNX'), 4096);
    assert.equal(isSupportedEmbeddingModel('onnx-community/Qwen3-Embedding-4B-ONNX'), true);
    assert.equal(isSupportedRerankerModel('onnx-community/Qwen3-Reranker-0.6B-ONNX'), true);
});

test('rejects models outside the supported Qwen3 set', () => {
    assert.throws(
        () => getEmbeddingDimensions('example/unsupported-model'),
        /Unsupported embedding model/
    );
    assert.equal(isSupportedEmbeddingModel('example/unsupported-model'), false);
    assert.equal(isSupportedRerankerModel('example/unsupported-model'), false);
});
