import path from 'path';
import { ConfigLoader } from './config/config-loader';
import { VectorStore } from './db/vector-store';
import { EmailIndexer } from './indexing/indexer';
import { TransformersJsEmbeddingClient } from './models/embedding-client';
import { TransformersJsRerankerClient } from './models/reranker-client';
import { EmlSource } from './sources/eml-source';
import { MailSource } from './sources/mail-source';
import { Config, ConfigDraft, EmailData, IndexedYearRange, IndexProgress, IndexSummary, ModelDtype, SearchCriteria } from './types';
import { matchesSearchFilters } from './search/keyword-filter';
import { getEmbeddingProfile } from './models/embedding-profile';
import { getModelDtypes } from './models/model-quantization';
import { isSupportedEmbeddingModel, isSupportedRerankerModel } from './models/qwen3-models';

class Semlix {
	private readonly configLoader = new ConfigLoader();
	private store: VectorStore | null = null;
	private storeEmbeddingProfile: string | null = null;
	private userDataPath: string | null = null;

	initialize(userDataPath: string): void {
		this.userDataPath = userDataPath;
		this.configLoader.initialize(userDataPath);
	}

	async loadConfig() {
		return this.configLoader.load();
	}

	requiresPathSelection(): boolean {
		return this.configLoader.requiresPathSelection();
	}

	getPathSelectionReason(): 'first-run' | 'invalid-path' | null {
		return this.configLoader.getPathSelectionReason();
	}

	loadConfigDraft(): ConfigDraft {
		return this.configLoader.getDraft();
	}

	saveConfig(config: ConfigDraft): Config {
		const previous = this.configLoader.current;
		const previousEmbeddingProfile = previous
			? getEmbeddingProfile(previous.semanticSearch)
			: null;
		const saved = this.configLoader.save(config);
		const nextEmbeddingProfile = getEmbeddingProfile(saved.semanticSearch);

		if (previousEmbeddingProfile && previousEmbeddingProfile !== nextEmbeddingProfile) {
			// Opening the store against the new profile immediately drops incompatible
			// semantic vectors while preserving parsed email and keyword-search rows.
			this.getStore();
		}

		return saved;
	}

	async getAvailableQuantizations(model: string): Promise<ModelDtype[]> {
		if (!isSupportedEmbeddingModel(model) && !isSupportedRerankerModel(model)) {
			throw new Error('Quantization discovery is limited to supported Qwen3 models.');
		}
		const config = this.configLoader.current || this.configLoader.getDraft();
		return getModelDtypes(model, this.getModelCachePath(config));
	}

	async getIndexedYearRange(): Promise<IndexedYearRange | null> {
		await this.configLoader.load();
		return this.getStore().getIndexedYearRange();
	}

	async search(criteria: SearchCriteria): Promise<EmailData[]> {
		await this.configLoader.load();

		if (criteria.mode === 'semantic') {
			return this.semanticSearch(criteria);
		}

		return this.getStore().searchKeyword(criteria);
	}

	async indexEmails(onProgress?: (progress: IndexProgress) => void): Promise<IndexSummary> {
		const config = await this.configLoader.load();
		const store = this.getStore();
		const embeddingClient = new TransformersJsEmbeddingClient(
			config.semanticSearch.embedding,
			this.getModelCachePath(config),
			onProgress
		);
		const indexer = new EmailIndexer(store, embeddingClient, this.createLocalSources(config));
		return indexer.indexAll(onProgress);
	}

	async clearSqlDatabase(): Promise<void> {
		this.getStore().clearSqlDatabase();
	}

	async clearVectorDatabase(): Promise<void> {
		this.getStore().clearVectorDatabase();
	}

	private async semanticSearch(criteria: SearchCriteria): Promise<EmailData[]> {
		const config = await this.configLoader.load();
		const store = this.getStore();
		if (!criteria.keyword.trim()) {
			return store.listEmails().filter(email => matchesSearchFilters(email, criteria));
		}

		const modelCachePath = this.getModelCachePath(config);
		const embeddingClient = new TransformersJsEmbeddingClient(config.semanticSearch.embedding, modelCachePath);
		const queryVector = await embeddingClient.embedQuery(criteria.keyword);
		const candidates = store.searchSemantic(queryVector, criteria, config.semanticSearch.topK);
		if (!config.semanticSearch.reranking.enabled) {
			return candidates.slice(0, config.semanticSearch.finalTopK);
		}

		const rerankerClient = new TransformersJsRerankerClient(config.semanticSearch.reranking, modelCachePath);
		const rerankTopK = Math.min(config.semanticSearch.rerankTopK, candidates.length);
		const reranked = await rerankerClient.rerank(
			criteria.keyword,
			candidates.slice(0, rerankTopK)
		);
		return [
			...reranked,
			...candidates.slice(rerankTopK)
		].slice(0, config.semanticSearch.finalTopK);
	}

	private createLocalSources(config: Config): MailSource[] {
		return [new EmlSource(config)];
	}

	private getStore(): VectorStore {
		if (!this.userDataPath) {
			throw new Error('Semlix has not been initialized with an Electron userData path.');
		}

		const config = this.configLoader.current;
		if (!config) {
			throw new Error('Config must be loaded before opening the vector database.');
		}

		const embeddingProfile = getEmbeddingProfile(config.semanticSearch);
		if (this.store && this.storeEmbeddingProfile !== embeddingProfile) {
			this.store.close();
			this.store = null;
		}

		if (!this.store) {
			this.store = new VectorStore(path.join(this.userDataPath, 'semlix.sqlite'), config.semanticSearch);
			this.storeEmbeddingProfile = embeddingProfile;
		}

		return this.store;
	}

	private getModelCachePath(config: Config): string {
		if (!this.userDataPath) {
			throw new Error('Semlix has not been initialized with an Electron userData path.');
		}
		return config.semanticSearch.modelCacheDir || path.join(this.userDataPath, 'models');
	}
}

export const semlix = new Semlix();
