import { EmailData, IndexProgress, MailSourceType } from '../types';

export interface MailSource {
	readonly type: MailSourceType;
	readonly id: string;
	listMessages(onProgress?: (progress: IndexProgress) => void): Promise<EmailData[]>;
}
