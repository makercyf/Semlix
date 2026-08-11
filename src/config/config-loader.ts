import fs from 'fs';
import path from 'path';
import {
	Config,
	ConfigDraft,
	ModelDtype,
	RawConfigFromFile,
	RawSemanticSearchConfig,
	SemanticSearchConfig
} from '../types';
import {
	isSupportedEmbeddingModel,
	isSupportedRerankerModel,
	QWEN3_EMBEDDING_MODEL,
	QWEN3_RERANKER_MODEL
} from '../models/qwen3-models';

const DEFAULT_SEMANTIC_SEARCH: SemanticSearchConfig = {
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
};

const SUPPORTED_DTYPES: ModelDtype[] = ['fp32', 'fp16', 'int8', 'uint8', 'q8', 'q4', 'q4f16', 'bnb4'];

export class ConfigLoader {
	private config: Config | null = null;
	private userConfigPath: string | null = null;

	initialize(userDataPath: string): void {
		this.userConfigPath = path.join(userDataPath, 'config.json');
	}

	async load(): Promise<Config> {
		const configPath = this.findConfigPath();
		if (!configPath) {
			throw new Error('Config file not found.');
		}

		const content = fs.readFileSync(configPath, 'utf-8');
		let raw: RawConfigFromFile;

		try {
			raw = JSON.parse(content) as RawConfigFromFile;
		} catch {
			throw new Error('Invalid JSON format in config file.');
		}

		this.config = this.validate(raw, path.dirname(configPath));
		return this.config;
	}

	get current(): Config | null {
		return this.config;
	}

	requiresPathSelection(): boolean {
		return this.getPathSelectionReason() !== null;
	}

	getPathSelectionReason(): 'first-run' | 'invalid-path' | null {
		if (!this.userConfigPath || !fs.existsSync(this.userConfigPath)) return 'first-run';

		try {
			const raw = this.readRaw(this.userConfigPath);
			this.validatePath(raw.path, path.dirname(this.userConfigPath));
			return null;
		} catch {
			return 'invalid-path';
		}
	}

	getDraft(): ConfigDraft {
		const source = this.findConfigPath();
		const raw = source ? this.tryReadRaw(source) : undefined;
		const configDirectory = source
			? path.dirname(source)
			: this.userConfigPath
				? path.dirname(this.userConfigPath)
				: process.cwd();
		const rawPath = typeof raw?.path === 'string' && raw.path.trim()
			? path.resolve(configDirectory, raw.path)
			: '';

		let semanticSearch = { ...DEFAULT_SEMANTIC_SEARCH };
		try {
			semanticSearch = this.validateSemanticSearch(raw?.semanticSearch, configDirectory);
		} catch {
			// A broken advanced setting should not prevent the settings panel from opening.
		}

		return {
			path: rawPath,
			timezone: source
				? this.getValidTimezoneOrSystem(raw?.timezone)
				: Intl.DateTimeFormat().resolvedOptions().timeZone,
			semanticSearch
		};
	}

	save(draft: ConfigDraft): Config {
		if (!this.userConfigPath) {
			throw new Error('The configuration store has not been initialized.');
		}

		const configDirectory = path.dirname(this.userConfigPath);
		const config = this.validate(draft, configDirectory);
		fs.mkdirSync(configDirectory, { recursive: true });

		const temporaryPath = `${this.userConfigPath}.tmp`;
		try {
			fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
			fs.renameSync(temporaryPath, this.userConfigPath);
		} finally {
			if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
		}

		this.config = config;
		return config;
	}

	private findConfigPath(): string | null {
		return this.userConfigPath && fs.existsSync(this.userConfigPath)
			? this.userConfigPath
			: null;
	}

	private readRaw(configPath: string): RawConfigFromFile {
		const content = fs.readFileSync(configPath, 'utf-8');
		try {
			return JSON.parse(content) as RawConfigFromFile;
		} catch {
			throw new Error('Invalid JSON format in config file.');
		}
	}

	private tryReadRaw(configPath: string): RawConfigFromFile | undefined {
		try {
			return this.readRaw(configPath);
		} catch {
			return undefined;
		}
	}

	private validate(raw: RawConfigFromFile, configDirectory: string): Config {
		const config: Config = {
			path: this.validatePath(raw.path, configDirectory),
			timezone: this.validateTimezone(raw.timezone),
			semanticSearch: this.validateSemanticSearch(raw.semanticSearch, configDirectory)
		};
		return config;
	}

	private validatePath(rawPath: unknown, configDirectory: string): string {
		if (typeof rawPath !== 'string' || rawPath.trim() === '') {
			throw new Error("Missing or invalid 'path' in config.json");
		}

		const resolved = path.resolve(configDirectory, rawPath);
		if (!fs.existsSync(resolved)) {
			throw new Error('The specified path does not exist.');
		}
		if (!fs.lstatSync(resolved).isDirectory()) {
			throw new Error('The specified path is not a directory.');
		}

		return resolved;
	}

	private validateTimezone(rawTimezone: unknown): string {
		if (typeof rawTimezone !== 'string' || rawTimezone.trim() === '') {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		}

		try {
			new Intl.DateTimeFormat(undefined, { timeZone: rawTimezone });
			return rawTimezone;
		} catch {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		}
	}

	private validateSemanticSearch(
		raw: RawSemanticSearchConfig | undefined,
		configDirectory: string
	): SemanticSearchConfig {
		const merged: SemanticSearchConfig = {
			...DEFAULT_SEMANTIC_SEARCH,
			...raw,
			embedding: {
				...DEFAULT_SEMANTIC_SEARCH.embedding,
				...raw?.embedding,
				options: {
					...DEFAULT_SEMANTIC_SEARCH.embedding.options,
					...raw?.embedding?.options
				}
			},
			reranking: {
				...DEFAULT_SEMANTIC_SEARCH.reranking,
				...raw?.reranking,
				options: {
					...DEFAULT_SEMANTIC_SEARCH.reranking.options,
					...raw?.reranking?.options
				}
			}
		};

		this.validateModelConfig('embedding', merged.embedding);
		this.validateModelConfig('reranking', merged.reranking);
		if (typeof merged.reranking.enabled !== 'boolean') {
			throw new Error('Invalid semanticSearch.reranking.enabled in config.json. Expected true or false.');
		}
		if (merged.modelCacheDir === undefined) {
			merged.modelCacheDir = path.join(configDirectory, 'models');
		} else {
			if (typeof merged.modelCacheDir !== 'string' || merged.modelCacheDir.trim() === '') {
				throw new Error('Invalid semanticSearch.modelCacheDir in config.json. Expected a directory path.');
			}
			merged.modelCacheDir = path.resolve(configDirectory, merged.modelCacheDir);
		}
		if (!Number.isInteger(merged.topK) || merged.topK <= 0) {
			throw new Error('Invalid semanticSearch.topK in config.json.');
		}
		if (!Number.isInteger(merged.rerankTopK) || merged.rerankTopK <= 0) {
			throw new Error('Invalid semanticSearch.rerankTopK in config.json.');
		}
		if (!Number.isInteger(merged.finalTopK) || merged.finalTopK <= 0) {
			throw new Error('Invalid semanticSearch.finalTopK in config.json.');
		}
		if (merged.rerankTopK > merged.topK) {
			throw new Error('semanticSearch.rerankTopK cannot be greater than topK.');
		}
		if (merged.finalTopK > merged.topK) {
			throw new Error('semanticSearch.finalTopK cannot be greater than topK.');
		}

		return merged;
	}

	private validateModelConfig(
		kind: 'embedding' | 'reranking',
		config: SemanticSearchConfig['embedding'] | SemanticSearchConfig['reranking']
	): void {
		if (config.provider !== 'transformers-js') {
			throw new Error(`Invalid semanticSearch.${kind}.provider in config.json. Expected 'transformers-js'.`);
		}
		if (typeof config.model !== 'string' || config.model.trim() === '') {
			throw new Error(`Invalid semanticSearch.${kind}.model in config.json. Expected a model name.`);
		}
		const modelSupported = kind === 'embedding'
			? isSupportedEmbeddingModel(config.model)
			: isSupportedRerankerModel(config.model);
		if (!modelSupported) {
			const supported = kind === 'embedding'
				? 'Qwen3 Embedding 0.6B, 4B, and 8B'
				: 'Qwen3 Reranker 0.6B';
			throw new Error(`Unsupported semanticSearch.${kind}.model in config.json. Semlix supports ${supported}.`);
		}
		if (!['cpu', 'webgpu'].includes(config.options.device)) {
			throw new Error(`Invalid semanticSearch.${kind}.options.device in config.json. Expected 'cpu' or 'webgpu'.`);
		}
		if (!SUPPORTED_DTYPES.includes(config.options.dtype)) {
			throw new Error(
				`Invalid semanticSearch.${kind}.options.dtype in config.json. Expected one of: ${SUPPORTED_DTYPES.join(', ')}.`
			);
		}
	}

	private getValidTimezoneOrSystem(rawTimezone: unknown): string {
		if (typeof rawTimezone === 'string' && rawTimezone.trim()) {
			try {
				new Intl.DateTimeFormat(undefined, { timeZone: rawTimezone });
				return rawTimezone;
			} catch {
				// Fall through to the system time zone.
			}
		}
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	}
}
