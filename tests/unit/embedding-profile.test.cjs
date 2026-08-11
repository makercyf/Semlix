const assert = require('node:assert/strict');
const test = require('node:test');

const { getEmbeddingProfile } = require('../../dist/models/embedding-profile.js');

function semanticConfig(model, dtype = 'q4', device = 'cpu') {
    return {
        embedding: {
            provider: 'transformers-js',
            model,
            options: { device, dtype }
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
}

test('embedding model and dtype changes create a new vector profile', () => {
    const baseline = getEmbeddingProfile(
        semanticConfig('onnx-community/Qwen3-Embedding-0.6B-ONNX')
    );
    const largerModel = getEmbeddingProfile(
        semanticConfig('onnx-community/Qwen3-Embedding-4B-ONNX', 'fp32')
    );
    const newDtype = getEmbeddingProfile(
        semanticConfig('onnx-community/Qwen3-Embedding-0.6B-ONNX', 'q8')
    );

    assert.notEqual(largerModel, baseline);
    assert.notEqual(newDtype, baseline);
});

test('device and reranker changes do not invalidate stored embeddings', () => {
    const baselineConfig = semanticConfig('onnx-community/Qwen3-Embedding-0.6B-ONNX');
    const deviceChanged = semanticConfig('onnx-community/Qwen3-Embedding-0.6B-ONNX', 'q4', 'webgpu');
    const rerankerChanged = semanticConfig('onnx-community/Qwen3-Embedding-0.6B-ONNX');
    rerankerChanged.reranking.enabled = true;
    rerankerChanged.reranking.options.dtype = 'q8';

    assert.equal(getEmbeddingProfile(deviceChanged), getEmbeddingProfile(baselineConfig));
    assert.equal(getEmbeddingProfile(rerankerChanged), getEmbeddingProfile(baselineConfig));
});
