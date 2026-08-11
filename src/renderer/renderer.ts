import type {
	ConfigDraft,
	SearchCriteria,
	EmailData,
	IndexProgress,
	ModelDtype,
	SortCriteria
} from '../types';
import { sortResults } from '../search/result-sort';
import {
	QWEN3_EMBEDDING_MODELS,
	QWEN3_RERANKER_MODEL
} from '../models/qwen3-models';

const keywordInput = document.getElementById('keyword-input') as HTMLInputElement;
const modeDropdown = document.getElementById('mode-dropdown') as HTMLSelectElement;
const senderInput = document.getElementById('sender-input') as HTMLInputElement;
const searchButton = document.getElementById('search-button') as HTMLButtonElement;
const searchButtonLabel = document.getElementById('search-button-label') as HTMLElement;
const tableBody = document.getElementById('mail-table-body') as HTMLTableSectionElement;
const loadingOverlay = document.getElementById('loading-indicator') as HTMLElement;
const searchProgressTitle = document.getElementById('search-progress-title') as HTMLElement;
const searchProgressDetail = document.getElementById('search-progress-detail') as HTMLElement;
const resultsTableContainer = document.querySelector('.results-table-container') as HTMLElement;
const indexButton = document.getElementById('index-button') as HTMLButtonElement;
const clearSqlButton = document.getElementById('clear-sql-button') as HTMLButtonElement;
const clearVecButton = document.getElementById('clear-vec-button') as HTMLButtonElement;
const indexProgressModal = document.getElementById('index-progress-modal') as HTMLDivElement;
const indexProgressBar = document.getElementById('index-progress-bar') as HTMLProgressElement;
const indexProgressText = document.getElementById('index-progress-text') as HTMLDivElement;
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
const settingsCloseButton = document.getElementById('settings-close-button') as HTMLButtonElement;
const settingsCancelButton = document.getElementById('settings-cancel-button') as HTMLButtonElement;
const settingsSaveButton = document.getElementById('settings-save-button') as HTMLButtonElement;
const settingsSetupNotice = document.getElementById('settings-setup-notice') as HTMLDivElement;
const settingsError = document.getElementById('settings-error') as HTMLDivElement;
const settingsPath = document.getElementById('settings-path') as HTMLInputElement;
const settingsBrowseButton = document.getElementById('settings-browse-button') as HTMLButtonElement;
const settingsTimezone = document.getElementById('settings-timezone') as HTMLInputElement;
const timezoneOptions = document.getElementById('timezone-options') as HTMLDataListElement;
const settingsEmbeddingModel = document.getElementById('settings-embedding-model') as HTMLSelectElement;
const embeddingModelDetail = document.getElementById('embedding-model-detail') as HTMLElement;
const settingsEmbeddingChangeNotice = document.getElementById('settings-embedding-change-notice') as HTMLElement;
const settingsEmbeddingQuantization = document.getElementById('settings-embedding-quantization') as HTMLSelectElement;
const embeddingQuantizationStatus = document.getElementById('embedding-quantization-status') as HTMLElement;
const settingsRerankingQuantization = document.getElementById('settings-reranking-quantization') as HTMLSelectElement;
const rerankingQuantizationStatus = document.getElementById('reranking-quantization-status') as HTMLElement;
const settingsRerankingEnabled = document.getElementById('settings-reranking-enabled') as HTMLInputElement;
const settingsTopK = document.getElementById('settings-top-k') as HTMLInputElement;
const settingsRerankTopK = document.getElementById('settings-rerank-top-k') as HTMLInputElement;
const settingsFinalTopK = document.getElementById('settings-final-top-k') as HTMLInputElement;

const dateInputs = {
	fromYear: document.getElementById('from-year-input') as HTMLInputElement,
	fromMonth: document.getElementById('from-month-input') as HTMLInputElement,
	fromDay: document.getElementById('from-day-input') as HTMLInputElement,
	toYear: document.getElementById('to-year-input') as HTMLInputElement,
	toMonth: document.getElementById('to-month-input') as HTMLInputElement,
	toDay: document.getElementById('to-day-input') as HTMLInputElement
};

let currentResults: EmailData[] = [];
let currentSort: SortCriteria | undefined;
let activeConfigDraft: ConfigDraft | null = null;
let settingsAreRequired = false;
let confirmedEmbeddingModel: string | null = null;
let searchInProgress = false;

const DTYPE_LABELS: Record<ModelDtype, string> = {
	fp32: 'FP32 (full precision)',
	fp16: 'FP16 (half precision)',
	int8: 'INT8 (signed 8-bit)',
	uint8: 'UINT8 (unsigned 8-bit)',
	q8: 'Q8 (8-bit quantized)',
	q4: 'Q4 (4-bit quantized)',
	q4f16: 'Q4F16 (4-bit weights, FP16 compute)',
	bnb4: 'BNB4 (4-bit bitsandbytes)'
};

function getSelectedDevice(name: 'settings-embedding-device' | 'settings-reranking-device'): 'cpu' | 'webgpu' {
	const selected = settingsForm.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
	return selected?.value === 'webgpu' ? 'webgpu' : 'cpu';
}

function showSettingsError(message: string) {
	settingsError.textContent = message;
	settingsError.hidden = false;
}

function clearSettingsError() {
	settingsError.textContent = '';
	settingsError.hidden = true;
}

function closeSettings() {
	if (settingsAreRequired) return;
	settingsModal.hidden = true;
	settingsButton.focus();
}

function populateTimezoneOptions(currentTimezone: string) {
	timezoneOptions.innerHTML = '';
	const intlWithSupportedValues = Intl as typeof Intl & {
		supportedValuesOf?: (key: 'timeZone') => string[];
	};
	const values = intlWithSupportedValues.supportedValuesOf?.('timeZone') || [currentTimezone];
	Array.from(new Set([currentTimezone, ...values])).filter(Boolean).forEach(timezone => {
		const option = document.createElement('option');
		option.value = timezone;
		timezoneOptions.appendChild(option);
	});
}

function populateSettingsForm(draft: ConfigDraft) {
	activeConfigDraft = draft;
	confirmedEmbeddingModel = null;
	settingsPath.value = draft.path;
	settingsTimezone.value = draft.timezone;
	populateTimezoneOptions(draft.timezone);
	settingsEmbeddingModel.innerHTML = '';
	QWEN3_EMBEDDING_MODELS.forEach(preset => {
		const option = document.createElement('option');
		option.value = preset.model;
		option.textContent = `${preset.label} · ${preset.dimensions} dimensions`;
		settingsEmbeddingModel.appendChild(option);
	});
	settingsEmbeddingModel.value = draft.semanticSearch.embedding.model;
	updateEmbeddingModelDetail();
	settingsEmbeddingChangeNotice.hidden = true;
	setSelectedDevice('settings-embedding-device', draft.semanticSearch.embedding.options.device);
	setSelectedDevice('settings-reranking-device', draft.semanticSearch.reranking.options.device);
	settingsRerankingEnabled.checked = draft.semanticSearch.reranking.enabled;
	settingsTopK.value = draft.semanticSearch.topK.toString();
	settingsRerankTopK.value = draft.semanticSearch.rerankTopK.toString();
	settingsFinalTopK.value = draft.semanticSearch.finalTopK.toString();
	populateQuantizationOptions(
		settingsEmbeddingQuantization,
		[draft.semanticSearch.embedding.options.dtype],
		draft.semanticSearch.embedding.options.dtype
	);
	populateQuantizationOptions(
		settingsRerankingQuantization,
		[draft.semanticSearch.reranking.options.dtype],
		draft.semanticSearch.reranking.options.dtype
	);
	embeddingQuantizationStatus.textContent = 'Checking formats for the embedding model.';
	rerankingQuantizationStatus.textContent = 'Checking formats for the reranker.';
}

function setSelectedDevice(
	name: 'settings-embedding-device' | 'settings-reranking-device',
	device: 'cpu' | 'webgpu'
) {
	const input = settingsForm.querySelector<HTMLInputElement>(`input[name="${name}"][value="${device}"]`);
	if (input) input.checked = true;
}

function updateEmbeddingModelDetail() {
	const preset = QWEN3_EMBEDDING_MODELS.find(candidate => candidate.model === settingsEmbeddingModel.value);
	embeddingModelDetail.textContent = preset
		? `${preset.dimensions} dimensions. ${preset.detail}.`
		: 'Choose the model used for indexing and search queries.';
}

function populateQuantizationOptions(
	select: HTMLSelectElement,
	dtypes: ModelDtype[],
	current: ModelDtype
) {
	const available = dtypes.length > 0 ? dtypes : [current];
	select.innerHTML = '';
	available.forEach(dtype => {
		const option = document.createElement('option');
		option.value = dtype;
		option.textContent = DTYPE_LABELS[dtype];
		option.selected = dtype === current;
		select.appendChild(option);
	});
	if (!available.includes(current)) select.value = available[0];
	select.disabled = false;
	if (select === settingsEmbeddingQuantization) refreshEmbeddingChangeNotice();
}

async function loadAvailableQuantizations(
	model: string,
	current: ModelDtype,
	select: HTMLSelectElement,
	status: HTMLElement,
	fallback: ModelDtype[] = [current]
) {
	select.disabled = true;
	status.textContent = 'Checking model formats...';
	const response = await window.electronAPI.getAvailableQuantizations(model);
	if (select === settingsEmbeddingQuantization && settingsEmbeddingModel.value !== model) return;

	if (!response.success) {
		populateQuantizationOptions(select, fallback, current);
		status.textContent = 'Formats could not be checked. The expected format remains available.';
		return;
	}

	const dtypes = response.result || [];
	const available = dtypes.length > 0 ? dtypes : fallback;
	populateQuantizationOptions(select, available, current);
	if (dtypes.length === 0) {
		status.textContent = 'No variants were reported. Using the expected model format.';
	} else if (!dtypes.includes(current)) {
		status.textContent = 'The previous format is unavailable. An available format was selected.';
	} else {
		status.textContent = `${dtypes.length} format${dtypes.length === 1 ? '' : 's'} available for this model.`;
	}
}

function embeddingFallbackDtypes(model: string): ModelDtype[] {
	return model === QWEN3_EMBEDDING_MODELS[0].model ? ['q4'] : ['fp32'];
}

function handleEmbeddingModelChange() {
	if (
		activeConfigDraft
		&& settingsEmbeddingModel.value !== activeConfigDraft.semanticSearch.embedding.model
		&& !window.confirm(
			'Changing the embedding model will delete all semantic chunks and vectors. Parsed emails and keyword-search data will be kept. You must index emails again. Continue?'
		)
	) {
		settingsEmbeddingModel.value = activeConfigDraft.semanticSearch.embedding.model;
		confirmedEmbeddingModel = null;
	} else {
		confirmedEmbeddingModel = settingsEmbeddingModel.value;
	}

	updateEmbeddingModelDetail();
	const selectedModel = settingsEmbeddingModel.value;
	const savedEmbedding = activeConfigDraft?.semanticSearch.embedding;
	const currentDtype = savedEmbedding?.model === selectedModel
		? savedEmbedding.options.dtype
		: embeddingFallbackDtypes(selectedModel)[0];
	const fallback = embeddingFallbackDtypes(selectedModel);
	populateQuantizationOptions(settingsEmbeddingQuantization, fallback, currentDtype);
	void loadAvailableQuantizations(
		selectedModel,
		currentDtype,
		settingsEmbeddingQuantization,
		embeddingQuantizationStatus,
		fallback
	);
}

function embeddingIndexWillChange(config: ConfigDraft): boolean {
	if (!activeConfigDraft) return false;
	return config.semanticSearch.embedding.provider !== activeConfigDraft.semanticSearch.embedding.provider
		|| config.semanticSearch.embedding.model !== activeConfigDraft.semanticSearch.embedding.model
		|| config.semanticSearch.embedding.options.dtype !== activeConfigDraft.semanticSearch.embedding.options.dtype;
}

function embeddingModelWillChange(config: ConfigDraft): boolean {
	return activeConfigDraft !== null
		&& config.semanticSearch.embedding.model !== activeConfigDraft.semanticSearch.embedding.model;
}

function refreshEmbeddingChangeNotice() {
	if (!activeConfigDraft) {
		settingsEmbeddingChangeNotice.hidden = true;
		return;
	}
	settingsEmbeddingChangeNotice.hidden = settingsEmbeddingModel.value === activeConfigDraft.semanticSearch.embedding.model
		&& settingsEmbeddingQuantization.value === activeConfigDraft.semanticSearch.embedding.options.dtype;
}

async function openSettings(required = false) {
	settingsAreRequired = required;
	indexButton.disabled = required;
	settingsSetupNotice.hidden = !required;
	settingsCloseButton.hidden = required;
	settingsCancelButton.hidden = required;
	clearSettingsError();

	const response = await window.electronAPI.loadConfigDraft();
	if (!response.success || !response.result) {
		await window.electronAPI.showError('Settings Error', response.error || 'Could not load settings.');
		return;
	}

	populateSettingsForm(response.result);
	settingsModal.hidden = false;
	if (required && !settingsPath.value) {
		settingsBrowseButton.focus();
	} else {
		settingsTimezone.focus();
	}
	void loadAvailableQuantizations(
		response.result.semanticSearch.embedding.model,
		response.result.semanticSearch.embedding.options.dtype,
		settingsEmbeddingQuantization,
		embeddingQuantizationStatus,
		embeddingFallbackDtypes(response.result.semanticSearch.embedding.model)
	);
	void loadAvailableQuantizations(
		QWEN3_RERANKER_MODEL,
		response.result.semanticSearch.reranking.options.dtype,
		settingsRerankingQuantization,
		rerankingQuantizationStatus,
		['q4']
	);
}

function parsePositiveInteger(input: HTMLInputElement, label: string): number {
	const value = Number(input.value);
	if (!Number.isInteger(value) || value <= 0 || value > 500) {
		throw new Error(`${label} must be a whole number between 1 and 500.`);
	}
	return value;
}

function validateTimezone(timezone: string): string {
	if (!timezone) throw new Error('Choose a time zone.');
	try {
		new Intl.DateTimeFormat(undefined, { timeZone: timezone });
		return timezone;
	} catch {
		throw new Error('Enter a valid IANA time zone, such as Asia/Hong_Kong.');
	}
}

function buildConfigFromSettings(): ConfigDraft {
	if (!activeConfigDraft) throw new Error('Settings have not finished loading.');
	if (!settingsPath.value.trim()) throw new Error('Choose an email archive folder.');

	const topK = parsePositiveInteger(settingsTopK, 'Candidates');
	const rerankTopK = parsePositiveInteger(settingsRerankTopK, 'Rerank');
	const finalTopK = parsePositiveInteger(settingsFinalTopK, 'Return');
	if (rerankTopK > topK) throw new Error('Rerank cannot be greater than Candidates.');
	if (finalTopK > topK) throw new Error('Return cannot be greater than Candidates.');

	return {
		...activeConfigDraft,
		path: settingsPath.value.trim(),
		timezone: validateTimezone(settingsTimezone.value.trim()),
		semanticSearch: {
			...activeConfigDraft.semanticSearch,
			embedding: {
				...activeConfigDraft.semanticSearch.embedding,
				model: settingsEmbeddingModel.value,
				options: {
					device: getSelectedDevice('settings-embedding-device'),
					dtype: settingsEmbeddingQuantization.value as ModelDtype
				}
			},
			reranking: {
				...activeConfigDraft.semanticSearch.reranking,
				enabled: settingsRerankingEnabled.checked,
				model: QWEN3_RERANKER_MODEL,
				options: {
					device: getSelectedDevice('settings-reranking-device'),
					dtype: settingsRerankingQuantization.value as ModelDtype
				}
			},
			topK,
			rerankTopK,
			finalTopK
		}
	};
}

async function saveSettings(event: SubmitEvent) {
	event.preventDefault();
	clearSettingsError();
	settingsSaveButton.disabled = true;
	settingsSaveButton.textContent = 'Saving...';
	try {
		const config = buildConfigFromSettings();
		const requiresSemanticReindex = embeddingIndexWillChange(config);
		const modelChangeNeedsConfirmation = embeddingModelWillChange(config)
			&& confirmedEmbeddingModel !== config.semanticSearch.embedding.model;
		const dtypeOnlyChangeNeedsConfirmation = requiresSemanticReindex && !embeddingModelWillChange(config);
		if ((modelChangeNeedsConfirmation || dtypeOnlyChangeNeedsConfirmation) && !window.confirm(
			'Changing the embedding configuration will delete all semantic chunks and vectors. Parsed emails and keyword-search data will be kept. You must index emails again. Continue?'
		)) {
			return;
		}
		const response = await window.electronAPI.saveConfig(config);
		if (!response.success || !response.result) {
			showSettingsError(response.error || 'Could not save settings.');
			return;
		}

		activeConfigDraft = response.result;
		settingsAreRequired = false;
		settingsModal.hidden = true;
		await populateIndexedYearRange();
		if (requiresSemanticReindex) {
			await window.electronAPI.showInfo(
				'Semantic Reindex Required',
				'Old semantic vectors were cleared. Use Settings > Email archive > Index emails to rebuild them with the new embedding model.'
			);
		}
	} catch (error) {
		showSettingsError(error instanceof Error ? error.message : 'Could not save settings.');
	} finally {
		settingsSaveButton.disabled = false;
		settingsSaveButton.textContent = 'Save settings';
	}
}

async function chooseArchiveDirectory() {
	clearSettingsError();
	const response = await window.electronAPI.selectArchiveDirectory(settingsPath.value || undefined);
	if (!response.success) {
		showSettingsError(response.error || 'Could not open the folder picker.');
		return;
	}
	if (!response.result) return;

	settingsPath.value = response.result;
	if (activeConfigDraft) {
		activeConfigDraft = { ...activeConfigDraft, path: response.result };
	}

	// A successful picker selection is already persisted by the main process,
	// so indexing can use it immediately even during first-run setup.
	settingsAreRequired = false;
	indexButton.disabled = false;
	settingsSetupNotice.hidden = true;
	settingsCloseButton.hidden = false;
	settingsCancelButton.hidden = false;
}

async function initializeApplication() {
	const response = await window.electronAPI.initializeConfig();
	if (!response.success || !response.result) {
		await openSettings(true);
		showSettingsError(response.error || 'Semlix needs valid settings before it can start.');
		return;
	}

	if (response.result.requiresSetup || !response.result.config) {
		await openSettings(true);
		return;
	}

	activeConfigDraft = response.result.config;
	await populateIndexedYearRange();
}

async function populateIndexedYearRange() {
	const res = await window.electronAPI.getIndexedYearRange();
	if (!res.success) {
		await window.electronAPI.showError('Date Range Error', res.error || 'Unknown error');
		return;
	}

	dateInputs.fromYear.value = res.result?.fromYear || '';
	dateInputs.toYear.value = res.result?.toYear || '';
}

function renderTable(results: EmailData[]) {
	tableBody.innerHTML = '';
	const sorted = sortResults(results, currentSort);
	if (sorted.length === 0) {
		const tr = tableBody.insertRow();
		const td = tr.insertCell();
		td.colSpan = 5;
		td.textContent = 'No results found.';
		return;
	}
	sorted.forEach(e => {
		const row = tableBody.insertRow();
		row.insertCell().textContent = e.name;
		row.insertCell().textContent = e.address;
		const subj = row.insertCell();
		subj.textContent = e.subject;
		subj.title = e.subject;
		row.insertCell().textContent = e.date.formatted;
		const att = row.insertCell();
		att.textContent = e.attachment;
		att.style.textAlign = 'center';
		row.dataset.path = e.path;
		row.addEventListener('dblclick', () => {
			window.electronAPI.openFile(e.path);
		});
	});
}

async function performSearch() {
	if (searchInProgress) return;

	const criteria: SearchCriteria = {
		keyword: keywordInput.value.trim(),
		sender: senderInput.value.trim(),
		mode: modeDropdown.value === 'semantic' ? 'semantic' : 'keyword',
		dateFrom: buildDateValue(dateInputs.fromYear, dateInputs.fromMonth, dateInputs.fromDay, false),
		dateTo: buildDateValue(dateInputs.toYear, dateInputs.toMonth, dateInputs.toDay, true)
	};

	setSearchInProgress(true, criteria.mode);
	try {
		const res = await window.electronAPI.searchEmails(criteria);
		if (!res.success) {
			await window.electronAPI.showError('Search Error', res.error || 'Unknown error');
			currentResults = [];
		} else {
			currentResults = res.result!;
		}
		renderTable(currentResults);
	} finally {
		setSearchInProgress(false, criteria.mode);
	}
}

function setSearchInProgress(inProgress: boolean, mode: SearchCriteria['mode']) {
	searchInProgress = inProgress;
	loadingOverlay.hidden = !inProgress;
	searchButton.disabled = inProgress;
	searchButton.classList.toggle('is-searching', inProgress);
	searchButtonLabel.textContent = inProgress ? 'Searching' : 'Search';
	resultsTableContainer.setAttribute('aria-busy', inProgress ? 'true' : 'false');

	if (!inProgress) return;

	const rerankingEnabled = mode === 'semantic'
		&& activeConfigDraft?.semanticSearch.reranking.enabled === true;
	if (rerankingEnabled) {
		searchProgressTitle.textContent = 'Semantic search and reranking in progress';
		searchProgressDetail.textContent = 'Enhanced reranking is enabled. This can take longer on a weaker device.';
		return;
	}

	if (mode === 'semantic') {
		searchProgressTitle.textContent = 'Semantic search in progress';
		searchProgressDetail.textContent = 'Comparing your query with the local semantic index.';
		return;
	}

	searchProgressTitle.textContent = 'Searching indexed email';
	searchProgressDetail.textContent = 'Applying keyword, sender, and date filters.';
}

async function performIndex() {
	settingsModal.hidden = true;
	showIndexProgress({ phase: 'discovery', processed: 0, total: 1, indexed: 0, skipped: 0 });
	const unsubscribe = window.electronAPI.onIndexProgress(showIndexProgress);
	try {
		const res = await window.electronAPI.indexEmails();
		if (!res.success) {
			await window.electronAPI.showError('Index Error', res.error || 'Unknown error');
			return;
		}
		await populateIndexedYearRange();
		await window.electronAPI.showInfo('Index Complete', `Successfully indexed ${res.result!.indexed} new files.`);
	} finally {
		unsubscribe();
		indexProgressModal.hidden = true;
	}
}

async function clearSqlDb() {
	if (!window.confirm('Clear all indexed mail? You will need to index your files again before searching.')) return;

	const res = await window.electronAPI.clearSqlDb();
	if (!res.success) {
		await window.electronAPI.showError('Clear Index Error', res.error || 'Unknown error');
		return;
	}
	dateInputs.fromYear.value = '';
	dateInputs.toYear.value = '';
	await window.electronAPI.showInfo('Mail Index Cleared', 'All locally indexed mail data has been cleared.');
}

async function clearVecDb() {
	if (!window.confirm('Clear semantic search data? Keyword search will continue to work.')) return;

	const res = await window.electronAPI.clearVecDb();
	if (!res.success) {
		await window.electronAPI.showError('Clear Semantic Data Error', res.error || 'Unknown error');
		return;
	}
	await window.electronAPI.showInfo('Semantic Data Cleared', 'Semantic search data has been cleared. Keyword search is still available.');
}

function showIndexProgress(progress: IndexProgress) {
	indexProgressModal.hidden = false;
	if (progress.phase === 'discovery') {
		indexProgressBar.max = Math.max(progress.total, 1);
		indexProgressBar.value = progress.processed;
		indexProgressText.textContent = progress.processed === 0
			? 'Scanning email files'
			: `Scanning email files: ${progress.processed}/${progress.total}`;
		return;
	}
	if (progress.phase === 'model') {
		indexProgressBar.max = 100;
		indexProgressBar.value = progress.downloadProgress ?? 0;
		const percent = progress.downloadProgress === undefined ? '' : ` (${progress.downloadProgress.toFixed(1)}%)`;
		const size = progress.loadedBytes && progress.totalBytes
			? ` ${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}`
			: '';
		indexProgressText.textContent = `${progress.current || 'Preparing model'}${percent}${size}`;
		return;
	}

	indexProgressBar.max = Math.max(progress.total, 1);
	indexProgressBar.value = progress.processed;
	indexProgressText.textContent = `${progress.processed}/${progress.total} processed, ${progress.indexed} indexed, ${progress.skipped} skipped`;
}

function formatBytes(value: number): string {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
	return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function buildDateValue(
	yearInput: HTMLInputElement,
	monthInput: HTMLInputElement,
	dayInput: HTMLInputElement,
	isEnd: boolean
): string | undefined {
	const year = yearInput.value.trim();
	if (!year) return undefined;

	const month = monthInput.value.trim() || (isEnd ? '12' : '01');
	const day = dayInput.value.trim() || (isEnd ? '31' : '01');
	return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function setSort(key: SortCriteria['key']) {
	const nextDirection = currentSort?.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc';
	currentSort = { key, direction: nextDirection };
	renderTable(currentResults);
}

document.addEventListener('DOMContentLoaded', () => {
	void initializeApplication();
	searchButton.addEventListener('click', performSearch);
	settingsButton.addEventListener('click', () => void openSettings(false));
	settingsCloseButton.addEventListener('click', closeSettings);
	settingsCancelButton.addEventListener('click', closeSettings);
	settingsBrowseButton.addEventListener('click', () => void chooseArchiveDirectory());
	settingsEmbeddingModel.addEventListener('change', handleEmbeddingModelChange);
	settingsEmbeddingQuantization.addEventListener('change', refreshEmbeddingChangeNotice);
	settingsForm.addEventListener('submit', event => void saveSettings(event));
	document.addEventListener('keydown', event => {
		if (event.key !== 'Escape') return;
		if (!settingsModal.hidden) {
			closeSettings();
		}
	});
	indexButton.addEventListener('click', performIndex);
	clearSqlButton.addEventListener('click', clearSqlDb);
	clearVecButton.addEventListener('click', clearVecDb);
	[keywordInput, senderInput].forEach(input =>
		input.addEventListener('keypress', e => {
			if (e.key === 'Enter') performSearch();
		})
	);
	Object.values(dateInputs).forEach(input =>
		input.addEventListener('keypress', e => {
			if (e.key === 'Enter') performSearch();
		})
	);
	document.querySelectorAll<HTMLTableCellElement>('th[data-sort-key]').forEach(header => {
		header.addEventListener('click', () => setSort(header.dataset.sortKey as SortCriteria['key']));
	});
});
