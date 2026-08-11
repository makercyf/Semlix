import { EmailData } from '../types';
import { getSearchableText } from '../email/email-parser';

const MAX_CHUNK_CHARS = 3500;
const OVERLAP_CHARS = 400;

export function chunkEmail(email: EmailData): string[] {
	const text = getSearchableText(email).replace(/\s+/g, ' ').trim();
	if (!text) return [];
	if (text.length <= MAX_CHUNK_CHARS) return [text];

	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		const end = Math.min(start + MAX_CHUNK_CHARS, text.length);
		chunks.push(text.slice(start, end));
		if (end === text.length) break;
		start = Math.max(end - OVERLAP_CHARS, start + 1);
	}

	return chunks;
}
