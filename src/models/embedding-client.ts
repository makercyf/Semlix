import { EmbeddingModelConfig, IndexProgress } from '../types';
import { loadPipeline } from './transformers-pipeline';

export interface EmbeddingClient {
	prepare(): Promise<void>;
	embedDocuments(texts: string[]): Promise<number[][]>;
	embedQuery(query: string): Promise<number[]>;
}

type FeatureExtractor = (texts: string | string[], options: { pooling: string; normalize: boolean }) => Promise<{
	tolist: () => number[] | number[][];
}>;

export class TransformersJsEmbeddingClient implements EmbeddingClient {
	private extractor: Promise<FeatureExtractor> | null = null;

	constructor(
		private readonly config: EmbeddingModelConfig,
		private readonly cacheDir?: string,
		private readonly onProgress?: (progress: IndexProgress) => void
	) {}

	async prepare(): Promise<void> {
		await this.getExtractor();
	}

	async embedDocuments(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		return this.embed(texts);
	}

	async embedQuery(query: string): Promise<number[]> {
		const task = 'Given a user email search query, retrieve relevant email passages.';
		const [embedding] = await this.embed([`Instruct: ${task}\nQuery:${query}`]);
		return embedding;
	}

	private async embed(texts: string[]): Promise<number[][]> {
		const extractor = await this.getExtractor();
		const output = await extractor(texts, { pooling: 'last_token', normalize: true });
		const vectors = output.tolist();
		if (!Array.isArray(vectors[0])) return [vectors as number[]];
		return vectors as number[][];
	}

	private async getExtractor(): Promise<FeatureExtractor> {
		if (!this.extractor) {
			this.extractor = this.createExtractor();
		}
		return this.extractor;
	}

	private async createExtractor(): Promise<FeatureExtractor> {
		this.onProgress?.({
			phase: 'model',
			processed: 0,
			total: 1,
			indexed: 0,
			skipped: 0,
			current: `Checking the model cache for ${this.config.model}`,
			model: this.config.model,
			cacheDir: this.cacheDir
		});

		try {
			return await loadPipeline<FeatureExtractor>('feature-extraction', this.config.model, {
				dtype: this.config.options.dtype,
				device: this.config.options.device,
				cacheDir: this.cacheDir,
				progressCallback: progress => this.reportProgress(progress as TransformerProgress)
			});
		} catch (error) {
			if (error instanceof Error && error.message.includes('Unsupported model type')) {
				throw new Error(
					`Embedding model "${this.config.model}" is not supported by this Transformers.js pipeline. ` +
					'This usually means the runtime loaded a Transformers.js build or model config that does not map this model type.'
				);
			}
			if (error instanceof Error && isModelAvailabilityError(error.message)) {
				throw new Error(
					`The embedding model "${this.config.model}" is not complete in the local cache and could not be downloaded. ` +
					'Check the internet connection and try Index emails again. Downloaded model files will remain cached for future use.'
				);
			}
			throw error;
		}
	}

	private reportProgress(progress: TransformerProgress): void {
		this.onProgress?.({
			phase: 'model',
			processed: 0,
			total: 1,
			indexed: 0,
			skipped: 0,
			current: formatModelProgress(progress),
			model: 'name' in progress ? progress.name : this.config.model,
			file: 'file' in progress ? progress.file : undefined,
			downloadProgress: progress.status === 'progress' ? progress.progress : undefined,
			loadedBytes: progress.status === 'progress' ? progress.loaded : undefined,
			totalBytes: progress.status === 'progress' ? progress.total : undefined,
			cacheDir: this.cacheDir
		});
	}
}

type TransformerProgress =
	| { status: 'initiate' | 'download' | 'done'; name: string; file: string }
	| { status: 'progress'; name: string; file: string; progress: number; loaded: number; total: number }
	| { status: 'ready'; task: string; model: string };

function formatModelProgress(progress: TransformerProgress): string {
	if (progress.status === 'ready') return `Model ready: ${progress.model}`;
	if (progress.status === 'progress') return `Downloading ${progress.file}`;
	if (progress.status === 'download') return `Downloading ${progress.file}`;
	if (progress.status === 'done') return `Loaded ${progress.file}`;
	return `Checking ${progress.file}`;
}

function isModelAvailabilityError(message: string): boolean {
	const normalized = message.toLocaleLowerCase();
	return normalized.includes('file was not found locally')
		|| normalized.includes('could not locate file')
		|| normalized.includes('fetch failed')
		|| normalized.includes('failed to fetch');
}
