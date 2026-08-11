export interface RawConfigFromFile {
	path?: string;
	timezone?: string;
	semanticSearch?: RawSemanticSearchConfig;
}

export interface Config {
	path: string;
	timezone: string;
	semanticSearch: SemanticSearchConfig;
}

export type ConfigDraft = Config;

export interface ConfigInitialization {
	config: Config | null;
	requiresSetup: boolean;
}

export type ModelDtype = 'fp32' | 'fp16' | 'int8' | 'uint8' | 'q8' | 'q4' | 'q4f16' | 'bnb4';

export type SearchMode = 'keyword' | 'semantic';

export interface ModelRuntimeOptions {
	device: 'cpu' | 'webgpu';
	dtype: ModelDtype;
}

export interface EmbeddingModelConfig {
	provider: 'transformers-js';
	model: string;
	options: ModelRuntimeOptions;
}

export interface RerankingModelConfig {
	enabled: boolean;
	provider: 'transformers-js';
	model: string;
	options: ModelRuntimeOptions;
}

export interface SemanticSearchConfig {
	embedding: EmbeddingModelConfig;
	reranking: RerankingModelConfig;
	modelCacheDir?: string;
	topK: number;
	rerankTopK: number;
	finalTopK: number;
}

export type RawSemanticSearchConfig = Partial<Omit<SemanticSearchConfig, 'embedding' | 'reranking'>> & {
	embedding?: Partial<Omit<EmbeddingModelConfig, 'options'>> & {
		options?: Partial<ModelRuntimeOptions>;
	};
	reranking?: Partial<Omit<RerankingModelConfig, 'options'>> & {
		options?: Partial<ModelRuntimeOptions>;
	};
};

export interface SearchCriteria {
	keyword: string;
	sender: string;
	mode: SearchMode;
	dateFrom?: string;
	dateTo?: string;
}

export type MailSourceType = 'eml';

export interface EmailData {
	id?: number;
	sourceType?: MailSourceType;
	sourceId?: string;
	name: string;
	address: string;
	subject: string;
	date: {
		timestamp: number;
		formatted: string;
	};
	attachment: "Yes" | "No";
	attachmentFilenames: string[];
	path: string;
	htmlContent?: string;
	textContent?: string;
	relevance?: number;
}

export interface IpcResponse<T> {
	success: boolean;
	result?: T;
	error?: string;
}

export interface IndexProgress {
	phase?: 'discovery' | 'model' | 'indexing';
	processed: number;
	total: number;
	current?: string;
	indexed: number;
	skipped: number;
	model?: string;
	file?: string;
	downloadProgress?: number;
	loadedBytes?: number;
	totalBytes?: number;
	cacheDir?: string;
}

export interface IndexSummary {
	indexed: number;
	skipped: number;
	total: number;
}

export interface IndexedYearRange {
	fromYear: string;
	toYear: string;
}

export interface SortCriteria {
	key: keyof Pick<EmailData, 'name' | 'address' | 'subject' | 'attachment'> | 'date' | 'relevance';
	direction: 'asc' | 'desc';
}

// Expose the exact same API shape on window.electronAPI
declare global {
	interface Window {
		electronAPI: {
			initializeConfig: () => Promise<IpcResponse<ConfigInitialization>>;
			loadConfig: () => Promise<IpcResponse<Config>>;
			loadConfigDraft: () => Promise<IpcResponse<ConfigDraft>>;
			saveConfig: (config: ConfigDraft) => Promise<IpcResponse<Config>>;
			selectArchiveDirectory: (defaultPath?: string) => Promise<IpcResponse<string | null>>;
			getAvailableQuantizations: (model: string) => Promise<IpcResponse<ModelDtype[]>>;
			getIndexedYearRange: () => Promise<IpcResponse<IndexedYearRange | null>>;
			searchEmails: (criteria: SearchCriteria) => Promise<IpcResponse<EmailData[]>>;
			indexEmails: () => Promise<IpcResponse<IndexSummary>>;
			clearSqlDb: () => Promise<IpcResponse<void>>;
			clearVecDb: () => Promise<IpcResponse<void>>;
			openFile: (filePath: string) => Promise<IpcResponse<void>>;
			showError: (title: string, message: string) => Promise<void>;
			showInfo: (title: string, message: string) => Promise<void>;
			showWarning: (title: string, message: string) => Promise<void>;
			onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void;
		};
	}
}
