import { SemanticSearchConfig } from '../types';
import { getEmbeddingDimensions } from './qwen3-models';

export function getEmbeddingProfile(config: SemanticSearchConfig): string {
	return JSON.stringify({
		provider: config.embedding.provider,
		model: config.embedding.model,
		dtype: config.embedding.options.dtype,
		dimensions: getEmbeddingDimensions(config.embedding.model)
	});
}
