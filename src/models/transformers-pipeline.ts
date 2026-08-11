import fs from 'fs';

interface TransformersModule {
	env: {
		cacheDir: string;
		useFSCache: boolean;
	};
	AutoTokenizer: {
		from_pretrained: (model: string, options: PretrainedOptions) => Promise<CausalLmTokenizer>;
	};
	AutoModelForCausalLM: {
		from_pretrained: (model: string, options: PretrainedOptions) => Promise<CausalLmModel>;
	};
	pipeline: (
		task: string,
		model: string,
		options: {
			dtype: string;
			device?: string;
			cache_dir?: string;
			local_files_only?: boolean;
			progress_callback?: (progress: unknown) => void;
		}
	) => Promise<unknown>;
}

interface PretrainedOptions {
	dtype?: string;
	device?: string;
	cache_dir?: string;
	local_files_only?: boolean;
	progress_callback?: (progress: unknown) => void;
}

export type ModelInputs = Record<string, unknown>;

export interface CausalLmTokenizer {
	(input: string, options: { truncation: boolean; max_length: number }): ModelInputs;
	convert_tokens_to_ids(token: string): number;
}

export interface CausalLmOutput {
	logits: {
		dims: number[];
		data: ArrayLike<number>;
	};
}

export interface CausalLmModel {
	(inputs: ModelInputs): Promise<CausalLmOutput>;
}

export interface CausalLmReranker {
	tokenizer: CausalLmTokenizer;
	model: CausalLmModel;
	yesTokenId: number;
	noTokenId: number;
}

export interface LoadPipelineOptions {
	dtype: string;
	device: 'cpu' | 'webgpu';
	cacheDir?: string;
	progressCallback?: (progress: unknown) => void;
}

const pipelineCache = new Map<string, Promise<unknown>>();
const causalLmRerankerCache = new Map<string, Promise<CausalLmReranker>>();

async function importTransformers(cacheDir?: string): Promise<TransformersModule> {
	if (cacheDir) {
		fs.mkdirSync(cacheDir, { recursive: true });
	}

	const transformers = await import('@huggingface/transformers') as unknown as TransformersModule;

	if (cacheDir) {
		transformers.env.cacheDir = cacheDir;
		transformers.env.useFSCache = true;
	}

	return transformers;
}

export async function loadPipeline<T>(task: string, model: string, options: LoadPipelineOptions): Promise<T> {
	const transformers = await importTransformers(options.cacheDir);

	const cacheKey = JSON.stringify([
		task,
		model,
		options.dtype,
		options.device,
		options.cacheDir || ''
	]);
	const existing = pipelineCache.get(cacheKey);
	if (existing) return existing as Promise<T>;

	const loading = transformers.pipeline(task, model, {
		dtype: options.dtype,
		device: options.device === 'webgpu' ? 'webgpu' : undefined,
		cache_dir: options.cacheDir,
		local_files_only: false,
		progress_callback: options.progressCallback
	}) as Promise<unknown>;
	pipelineCache.set(cacheKey, loading);

	try {
		return await loading as T;
	} catch (error) {
		if (pipelineCache.get(cacheKey) === loading) {
			pipelineCache.delete(cacheKey);
		}
		throw error;
	}
}

export async function loadCausalLmReranker(
	model: string,
	options: LoadPipelineOptions
): Promise<CausalLmReranker> {
	const cacheKey = JSON.stringify([
		'causal-lm-reranker',
		model,
		options.dtype,
		options.device,
		options.cacheDir || ''
	]);
	const existing = causalLmRerankerCache.get(cacheKey);
	if (existing) return existing;

	const loading = createCausalLmReranker(model, options);
	causalLmRerankerCache.set(cacheKey, loading);

	try {
		return await loading;
	} catch (error) {
		if (causalLmRerankerCache.get(cacheKey) === loading) {
			causalLmRerankerCache.delete(cacheKey);
		}
		throw error;
	}
}

async function createCausalLmReranker(
	model: string,
	options: LoadPipelineOptions
): Promise<CausalLmReranker> {
	const transformers = await importTransformers(options.cacheDir);
	const commonOptions: PretrainedOptions = {
		cache_dir: options.cacheDir,
		local_files_only: false,
		progress_callback: options.progressCallback
	};
	const [tokenizer, causalLm] = await Promise.all([
		transformers.AutoTokenizer.from_pretrained(model, commonOptions),
		transformers.AutoModelForCausalLM.from_pretrained(model, {
			...commonOptions,
			dtype: options.dtype,
			device: options.device
		})
	]);
	const yesTokenId = tokenizer.convert_tokens_to_ids('yes');
	const noTokenId = tokenizer.convert_tokens_to_ids('no');

	if (!Number.isInteger(yesTokenId) || !Number.isInteger(noTokenId) || yesTokenId === noTokenId) {
		throw new Error(`Reranker model "${model}" does not expose distinct yes/no token IDs.`);
	}

	return { tokenizer, model: causalLm, yesTokenId, noTokenId };
}
