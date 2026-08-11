export const QWEN3_EMBEDDING_MODELS = [
	{
		model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
		label: 'Qwen3 Embedding 0.6B',
		dimensions: 1024,
		detail: 'Recommended for most devices'
	},
	{
		model: 'onnx-community/Qwen3-Embedding-4B-ONNX',
		label: 'Qwen3 Embedding 4B',
		dimensions: 2560,
		detail: 'Large FP32 model, approximately 16 GB'
	},
	{
		model: 'onnx-community/Qwen3-Embedding-8B-ONNX',
		label: 'Qwen3 Embedding 8B',
		dimensions: 4096,
		detail: 'Very large FP32 model, approximately 30 GB'
	}
] as const;

export const QWEN3_EMBEDDING_MODEL = QWEN3_EMBEDDING_MODELS[0].model;
export const QWEN3_RERANKER_MODEL = 'onnx-community/Qwen3-Reranker-0.6B-ONNX';

export function getEmbeddingDimensions(model: string): number {
	const preset = QWEN3_EMBEDDING_MODELS.find(candidate => candidate.model === model);
	if (!preset) {
		throw new Error(`Unsupported embedding model "${model}". Semlix supports Qwen3 Embedding 0.6B, 4B, and 8B.`);
	}
	return preset.dimensions;
}

export function isSupportedEmbeddingModel(model: string): boolean {
	return QWEN3_EMBEDDING_MODELS.some(candidate => candidate.model === model);
}

export function isSupportedRerankerModel(model: string): boolean {
	return model === QWEN3_RERANKER_MODEL;
}
