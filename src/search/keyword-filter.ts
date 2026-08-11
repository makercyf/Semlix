import { EmailData, SearchCriteria } from '../types';
import { getSearchableText } from '../email/email-parser';
import { parseDateStartMs, parseDateEndMs } from './date-range';

export function matchesSearchFilters(email: EmailData, criteria: SearchCriteria): boolean {
	if (!matchesSender(email, criteria.sender)) return false;
	if (!matchesDateRange(email, criteria.dateFrom, criteria.dateTo)) return false;
	return true;
}

export function matchesKeyword(email: EmailData, keyword: string): boolean {
	const normalizedKeyword = keyword.trim().toLocaleUpperCase();
	if (!normalizedKeyword) return true;

	return getSearchableText(email).toLocaleUpperCase().includes(normalizedKeyword);
}

function matchesSender(email: EmailData, sender: string): boolean {
	const normalizedSender = sender.trim().toLocaleUpperCase();
	if (!normalizedSender) return true;

	return [email.name, email.address]
		.some(value => value.toLocaleUpperCase().includes(normalizedSender));
}

function matchesDateRange(email: EmailData, dateFrom?: string, dateTo?: string): boolean {
	const timestampMs = email.date.timestamp * 1000;
	const from = parseDateStartMs(dateFrom);
	const to = parseDateEndMs(dateTo);

	if (from !== null && timestampMs < from) return false;
	if (to !== null && timestampMs > to) return false;
	return true;
}
