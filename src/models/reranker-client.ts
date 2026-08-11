import { EmailData, RerankingModelConfig } from '../types';
import { getSearchableText } from '../email/email-parser';
import { CausalLmOutput, CausalLmReranker, loadCausalLmReranker } from './transformers-pipeline';

export interface RerankerClient {
	rerank(query: string, results: EmailData[]): Promise<EmailData[]>;
}

export class TransformersJsRerankerClient implements RerankerClient {
	private ranker: Promise<CausalLmReranker | null> | null = null;

	constructor(
		private readonly config: RerankingModelConfig,
		private readonly cacheDir?: string
	) {}

	async rerank(query: string, results: EmailData[]): Promise<EmailData[]> {
		if (!query.trim() || results.length <= 1) return results;

		const ranker = await this.getRanker();
		if (!ranker) return results;

		try {
			const scored = [];
			for (let index = 0; index < results.length; index += 1) {
				const result = results[index];
				const prompt = this.formatRerankPrompt(query, result);
				const inputs = ranker.tokenizer(prompt, { truncation: true, max_length: 8192 });
				const output = await ranker.model(inputs);
				scored.push({
					result,
					score: this.getRelevanceScore(output, ranker),
					index
				});
			}

			return scored
				.sort((a, b) => (b.score - a.score) || (a.index - b.index))
				.map(item => ({ ...item.result, relevance: item.score }));
		} catch (error) {
			console.warn('Reranker scoring failed; falling back to vector score ordering.', error);
			return results;
		}
	}

	private async getRanker(): Promise<CausalLmReranker | null> {
		if (!this.ranker) {
			this.ranker = this.createRanker();
		}
		return this.ranker;
	}

	private async createRanker(): Promise<CausalLmReranker | null> {
		try {
			return await loadCausalLmReranker(this.config.model, {
				dtype: this.config.options.dtype,
				device: this.config.options.device,
				cacheDir: this.cacheDir
			});
		} catch (error) {
			console.warn('Reranker model could not be loaded; falling back to vector score ordering.', error);
			return null;
		}
	}

	private formatRerankPrompt(query: string, email: EmailData): string {
		const systemPrompt =
			'Judge whether the Document meets the requirements based on the Query and the Instruct provided. ' +
			'Note that the answer can only be "yes" or "no".';
		const instruction = 'Retrieve relevant email passages that answer the query';
		const document = getSearchableText(email).slice(0, 8000);

		return (
			`<|im_start|>system\n${systemPrompt}<|im_end|>\n` +
			`<|im_start|>user\n<Instruct>: ${instruction}\n\n<Query>: ${query}\n\n<Document>: ${document}<|im_end|>\n` +
			'<|im_start|>assistant\n<think>\n\n</think>\n'
		);
	}

	private getRelevanceScore(output: CausalLmOutput, ranker: CausalLmReranker): number {
		const { dims, data } = output.logits;
		if (dims.length !== 3 || dims[0] !== 1) {
			throw new Error(`Unexpected reranker logits shape: [${dims.join(', ')}].`);
		}

		const sequenceLength = dims[1];
		const vocabularySize = dims[2];
		if (
			sequenceLength <= 0 ||
			ranker.yesTokenId >= vocabularySize ||
			ranker.noTokenId >= vocabularySize
		) {
			throw new Error('Reranker logits do not contain the expected yes/no tokens.');
		}

		const finalTokenOffset = (sequenceLength - 1) * vocabularySize;
		const yesLogit = Number(data[finalTokenOffset + ranker.yesTokenId]);
		const noLogit = Number(data[finalTokenOffset + ranker.noTokenId]);
		if (!Number.isFinite(yesLogit) || !Number.isFinite(noLogit)) {
			throw new Error('Reranker produced invalid yes/no logits.');
		}

		const difference = yesLogit - noLogit;
		if (difference >= 0) return 1 / (1 + Math.exp(-difference));
		const exponential = Math.exp(difference);
		return exponential / (1 + exponential);
	}
}
