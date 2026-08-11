import { contextBridge, ipcRenderer } from 'electron';
import type {
	Config,
	ConfigDraft,
	ConfigInitialization,
	SearchCriteria,
	EmailData,
	IndexedYearRange,
	IpcResponse,
	IndexProgress,
	IndexSummary,
	ModelDtype
} from './types';

contextBridge.exposeInMainWorld('electronAPI', {
	initializeConfig: (): Promise<IpcResponse<ConfigInitialization>> =>
		ipcRenderer.invoke('initialize-config'),

	loadConfig: (): Promise<IpcResponse<Config>> =>
		ipcRenderer.invoke('load-config'),

	loadConfigDraft: (): Promise<IpcResponse<ConfigDraft>> =>
		ipcRenderer.invoke('load-config-draft'),

	saveConfig: (config: ConfigDraft): Promise<IpcResponse<Config>> =>
		ipcRenderer.invoke('save-config', config),

	selectArchiveDirectory: (defaultPath?: string): Promise<IpcResponse<string | null>> =>
		ipcRenderer.invoke('select-archive-directory', defaultPath),

	getAvailableQuantizations: (model: string): Promise<IpcResponse<ModelDtype[]>> =>
		ipcRenderer.invoke('get-available-quantizations', model),

	getIndexedYearRange: (): Promise<IpcResponse<IndexedYearRange | null>> =>
		ipcRenderer.invoke('get-indexed-year-range'),

	searchEmails: (criteria: SearchCriteria): Promise<IpcResponse<EmailData[]>> =>
		ipcRenderer.invoke('search-emails', criteria),

	indexEmails: (): Promise<IpcResponse<IndexSummary>> =>
		ipcRenderer.invoke('index-emails'),

	clearSqlDb: (): Promise<IpcResponse<void>> =>
		ipcRenderer.invoke('clear-sql-db'),

	clearVecDb: (): Promise<IpcResponse<void>> =>
		ipcRenderer.invoke('clear-vec-db'),

	openFile: (filePath: string): Promise<IpcResponse<void>> =>
		ipcRenderer.invoke('open-file', filePath),

	showError: (title: string, message: string): Promise<void> =>
		ipcRenderer.invoke('show-error', title, message),

	showWarning: (title: string, message: string): Promise<void> =>
		ipcRenderer.invoke('show-warning', title, message),

	showInfo: (title: string, message: string): Promise<void> =>
		ipcRenderer.invoke('show-info', title, message),

	onIndexProgress: (callback: (progress: IndexProgress) => void): (() => void) => {
		const listener = (_event: Electron.IpcRendererEvent, progress: IndexProgress) => callback(progress);
		ipcRenderer.on('index-progress', listener);
		return () => ipcRenderer.removeListener('index-progress', listener);
	}
});
