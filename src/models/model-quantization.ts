import { ModelDtype } from '../types';

interface ModelRegistryApi {
	get_available_dtypes: (
		modelId: string,
		options?: { cache_dir?: string }
	) => Promise<string[]>;
}

interface TransformersRegistryModule {
	ModelRegistry: ModelRegistryApi;
}

const SUPPORTED_DTYPES: ModelDtype[] = [
	'fp32',
	'fp16',
	'int8',
	'uint8',
	'q8',
	'q4',
	'q4f16',
	'bnb4'
];

const dtypeCache = new Map<string, Promise<ModelDtype[]>>();

export async function getModelDtypes(
	model: string,
	cacheDir?: string
): Promise<ModelDtype[]> {
	const cacheKey = JSON.stringify([model, cacheDir || '']);
	const cached = dtypeCache.get(cacheKey);
	if (cached) return cached;

	const lookup = lookupModelDtypes(model, cacheDir);
	dtypeCache.set(cacheKey, lookup);
	try {
		return await lookup;
	} catch (error) {
		dtypeCache.delete(cacheKey);
		throw error;
	}
}

async function lookupModelDtypes(
	model: string,
	cacheDir?: string
): Promise<ModelDtype[]> {
	const transformers = await import('@huggingface/transformers') as unknown as TransformersRegistryModule;
	const options = cacheDir ? { cache_dir: cacheDir } : undefined;
	const available = await transformers.ModelRegistry.get_available_dtypes(model, options);
	return SUPPORTED_DTYPES.filter(dtype => available.includes(dtype));
}
