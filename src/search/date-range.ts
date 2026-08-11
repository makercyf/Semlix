export function parseDateStartMs(value?: string): number | null {
	if (!value) return null;
	const parsed = Date.parse(`${value}T00:00:00`);
	return Number.isNaN(parsed) ? null : parsed;
}

export function parseDateEndMs(value?: string): number | null {
	if (!value) return null;
	const parsed = Date.parse(`${value}T23:59:59`);
	return Number.isNaN(parsed) ? null : parsed;
}
