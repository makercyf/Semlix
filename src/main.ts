import { app, BrowserWindow, ipcMain, dialog, shell, Menu, IpcMainInvokeEvent } from "electron";
import path from "path";
import { semlix } from "./semlix";
import type { ConfigDraft } from './types';

let mainWindow: BrowserWindow;
const WINDOWS_APP_ID = "com.local.semlix";

app.setPath('userData', path.join(app.getPath('appData'), 'Semlix'));
if (process.platform === "win32") {
	app.setAppUserModelId(WINDOWS_APP_ID);
}

function getWindowIconPath(): string | undefined {
	if (process.platform === "win32") {
		return app.isPackaged
			? path.join(process.resourcesPath, "icon.ico")
			: path.join(__dirname, "..", "imgs", "icons", "semlix-icon.ico");
	}

	if (process.platform === "linux") {
		return app.isPackaged
			? path.join(process.resourcesPath, "icon.png")
			: path.join(__dirname, "..", "build", "png", "icon-512x512.png");
	}

	// macOS gets its application and Dock icon from the signed app bundle.
	return undefined;
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		icon: getWindowIconPath(),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
	// mainWindow.webContents.openDevTools();
}

// Wraps an IPC handler so its result/error is returned in the { success, result, error } envelope the renderer expects.
function handle<T>(
	channel: string,
	fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T
): void {
	ipcMain.handle(channel, async (event, ...args) => {
		try {
			const result = await fn(event, ...args);
			return { success: true, result };
		} catch (e: any) {
			return { success: false, error: e.message };
		}
	});
}

app.whenReady().then(() => {
	semlix.initialize(app.getPath('userData'));
	Menu.setApplicationMenu(null);
	createWindow();

	handle("load-config", () => semlix.loadConfig());
	handle("initialize-config", async () => {
		const pathSelectionReason = semlix.getPathSelectionReason();
		if (!pathSelectionReason) {
			return { config: await semlix.loadConfig(), requiresSetup: false };
		}

		const draft = semlix.loadConfigDraft();
		const explanation = await dialog.showMessageBox(mainWindow, {
			type: 'info',
			title: 'Email archive folder required',
			message: 'Semlix needs an email archive folder before it can start.',
			detail: pathSelectionReason === 'invalid-path'
				? `The configured folder is missing or no longer available${draft.path ? `:\n${draft.path}` : '.'}\n\nChoose the folder that contains your email archive.`
				: 'This is the first time Semlix has been opened. Choose the folder that contains your email archive so Semlix can index and search your local email.',
			buttons: ['Choose folder', 'Not now'],
			defaultId: 0,
			cancelId: 1,
			noLink: true
		});
		if (explanation.response !== 0) {
			return { config: null, requiresSetup: true };
		}

		const selection = await dialog.showOpenDialog(mainWindow, {
			title: 'Choose your email archive',
			buttonLabel: 'Use this folder',
			defaultPath: draft.path || undefined,
			properties: ['openDirectory', 'createDirectory']
		});
		if (selection.canceled || selection.filePaths.length === 0) {
			return { config: null, requiresSetup: true };
		}

		return {
			config: semlix.saveConfig({ ...draft, path: selection.filePaths[0] }),
			requiresSetup: false
		};
	});
	handle("load-config-draft", () => semlix.loadConfigDraft());
	handle("save-config", (_event, config: ConfigDraft) => semlix.saveConfig(config));
	handle("select-archive-directory", async (_event, defaultPath?: string) => {
		const selection = await dialog.showOpenDialog(mainWindow, {
			title: 'Choose your email archive',
			buttonLabel: 'Use this folder',
			defaultPath: defaultPath || undefined,
			properties: ['openDirectory', 'createDirectory']
		});
		const selectedPath = selection.canceled ? null : selection.filePaths[0] || null;
		if (!selectedPath) return null;

		// Persist only the folder selected by this picker. Other settings remain
		// unchanged until the user explicitly saves the settings form.
		const saved = semlix.saveConfig({
			...semlix.loadConfigDraft(),
			path: selectedPath
		});
		return saved.path;
	});
	handle("get-available-quantizations", (_event, model: string) => semlix.getAvailableQuantizations(model));
	handle("get-indexed-year-range", () => semlix.getIndexedYearRange());
	handle("search-emails", (_event, criteria) => semlix.search(criteria));
	handle("index-emails", event =>
		semlix.indexEmails(progress => event.sender.send('index-progress', progress)));
	handle("clear-sql-db", () => semlix.clearSqlDatabase());
	handle("clear-vec-db", () => semlix.clearVectorDatabase());
	handle("open-file", (_event, filePath) => shell.openPath(filePath));

	ipcMain.handle("show-error", (_event, title: string, message: string) => {
		dialog.showErrorBox(title, message);
	});

	ipcMain.handle("show-warning", (_event, title: string, message: string) => {
		dialog.showMessageBoxSync(mainWindow, { type: "warning", title, message });
	});

	ipcMain.handle("show-info", (_event, title: string, message: string) => {
		dialog.showMessageBoxSync(mainWindow, { type: "info", title, message });
	});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
