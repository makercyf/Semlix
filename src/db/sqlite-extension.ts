import path from 'path';
import * as sqliteVec from 'sqlite-vec';

interface ExtensionDatabase {
	loadExtension(filePath: string, entryPoint?: string): void;
}

export function getSqliteVecExtensionPath(): string {
	const extensionPath = sqliteVec.getLoadablePath();
	const asarSegment = `${path.sep}app.asar${path.sep}`;
	const unpackedSegment = `${path.sep}app.asar.unpacked${path.sep}`;
	return extensionPath.replace(asarSegment, unpackedSegment);
}

export function loadSqliteVec(database: ExtensionDatabase): void {
	database.loadExtension(getSqliteVecExtensionPath());
}
