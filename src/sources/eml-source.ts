import { glob } from 'glob';
import path from 'path';
import { Config, EmailData, IndexProgress } from '../types';
import { parseEmlFile } from '../email/email-parser';
import { MailSource } from './mail-source';

export class EmlSource implements MailSource {
	readonly type = 'eml' as const;
	readonly id = 'local-eml';

	constructor(private readonly config: Config) {}

	async listMessages(onProgress?: (progress: IndexProgress) => void): Promise<EmailData[]> {
		const pattern = path.join(this.config.path, '**/*.eml').replace(/\\/g, '/');
		const files = await glob(pattern, { nodir: true });
		const messages: EmailData[] = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			try {
				messages.push(await parseEmlFile(file, this.config.timezone));
			} catch (error) {
				console.error(`Failed to parse ${file}:`, error);
			}

			onProgress?.({
				phase: 'discovery',
				processed: i + 1,
				total: files.length,
				current: file,
				indexed: 0,
				skipped: 0
			});
		}

		return messages;
	}
}
