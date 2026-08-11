import fs from 'fs';
import { simpleParser } from 'mailparser';
import { format, toZonedTime } from 'date-fns-tz';
import * as cheerio from 'cheerio';
import { EmailData, MailSourceType } from '../types';

export interface ParsedEmailOptions {
	sourceType: MailSourceType;
	sourceId: string;
	path: string;
	timezone: string;
	raw: Buffer;
}

export async function parseEmlFile(filePath: string, timezone: string): Promise<EmailData> {
	const raw = fs.readFileSync(filePath);
	return parseRawEmail({
		sourceType: 'eml',
		sourceId: filePath,
		path: filePath,
		timezone,
		raw
	});
}

export async function parseRawEmail(options: ParsedEmailOptions): Promise<EmailData> {
	const parsed = await simpleParser(options.raw);
	const fromEntry = parsed.from?.value?.[0];
	const name = fromEntry?.name || '';
	const address = fromEntry?.address || '';
	const subject = parsed.subject || '';
	const dateObj = parsed.date || new Date(0);
	const timestamp = Math.floor(dateObj.getTime() / 1000);
	const zoned = toZonedTime(dateObj, options.timezone);
	const formatted = format(zoned, 'yyyy.MM.dd EEE HH.mm.ss', { timeZone: options.timezone });

	const attachmentFilenames = parsed.attachments?.map(a => a.filename || '').filter(Boolean) || [];
	const attachment: EmailData['attachment'] = attachmentFilenames.length > 0 ? 'Yes' : 'No';

	return {
		sourceType: options.sourceType,
		sourceId: options.sourceId,
		name,
		address,
		subject,
		date: { timestamp, formatted },
		attachment,
		attachmentFilenames,
		path: options.path,
		textContent: parsed.text || '',
		htmlContent: extractHtmlText(parsed.html)
	};
}

export function getSearchableText(email: EmailData): string {
	return [
		email.name,
		email.address,
		email.subject,
		email.textContent || '',
		email.htmlContent || '',
		...email.attachmentFilenames
	]
		.filter(Boolean)
		.join('\n');
}

function extractHtmlText(html: string | false | undefined): string {
	if (!html || typeof html !== 'string') return '';

	const $ = cheerio.load(html);
	$('style, script, head').remove();
	return $('body').text().replace(/\s+/g, ' ').trim();
}
