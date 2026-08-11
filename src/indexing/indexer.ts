import { VectorStore } from '../db/vector-store';
import { EmbeddingClient } from '../models/embedding-client';
import { EmailData, IndexProgress, IndexSummary } from '../types';
import { MailSource } from '../sources/mail-source';
import { chunkEmail } from './chunker';

export class EmailIndexer {
	constructor(
		private readonly store: VectorStore,
		private readonly embeddingClient: EmbeddingClient | null,
		private readonly sources: MailSource[]
	) {}

	async indexAll(onProgress?: (progress: IndexProgress) => void): Promise<IndexSummary> {
		let indexed = 0;
		let skipped = 0;
		let processed = 0;
		const allMessages: EmailData[] = [];

		for (const source of this.sources) {
			allMessages.push(...await source.listMessages(onProgress));
		}

		const total = allMessages.length;
		if (total > 0 && this.embeddingClient) {
			await this.embeddingClient.prepare();
		}

		for (const email of allMessages) {
			const textChunks = chunkEmail(email);
			if (textChunks.length === 0) {
				skipped++;
			} else if (this.embeddingClient) {
				const vectors = await this.embeddingClient.embedDocuments(textChunks);
				const inserted = this.store.upsertEmail(
					email,
					textChunks.map((text, index) => ({ text, vector: vectors[index] }))
				);
				if (inserted) indexed++;
				else skipped++;
			} else {
				if (this.store.upsertEmail(email)) indexed++;
				else skipped++;
			}

			processed++;
			onProgress?.({
				phase: 'indexing',
				processed,
				total,
				current: email.subject || email.path,
				indexed,
				skipped
			});
		}

		return { indexed, skipped, total };
	}
}
