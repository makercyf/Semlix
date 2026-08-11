import { EmailData, SortCriteria } from '../types';

export function sortResults(results: EmailData[], sort?: SortCriteria): EmailData[] {
	if (!sort) return results;

	const direction = sort.direction === 'asc' ? 1 : -1;
	return [...results].sort((a, b) => compareValue(getValue(a, sort.key), getValue(b, sort.key)) * direction);
}

function getValue(email: EmailData, key: SortCriteria['key']): string | number {
	if (key === 'date') return email.date.timestamp;
	if (key === 'relevance') return email.relevance ?? Number.NEGATIVE_INFINITY;
	return email[key] || '';
}

function compareValue(a: string | number, b: string | number): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}
