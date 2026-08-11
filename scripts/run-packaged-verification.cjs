const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const applicationRootArgument = process.argv[2];
if (!applicationRootArgument) {
	throw new Error('Expected the unpacked application root as the first argument.');
}

const applicationRoot = path.resolve(applicationRootArgument);
let executablePath;
if (process.platform === 'win32') {
	executablePath = path.join(applicationRoot, 'Semlix.exe');
} else if (process.platform === 'darwin') {
	executablePath = path.join(applicationRoot, 'Contents', 'MacOS', 'Semlix');
} else if (process.platform === 'linux') {
	executablePath = path.join(applicationRoot, 'semlix');
} else {
	throw new Error(`Unsupported packaged-runtime verification platform: ${process.platform}`);
}

if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
	throw new Error(`Packaged application executable was not found: ${executablePath}`);
}

const verificationScript = path.join(__dirname, 'verify-packaged-runtime.cjs');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'semlix-runtime-'));

const result = spawnSync(executablePath, [verificationScript, applicationRoot], {
	env: {
		...process.env,
		ELECTRON_RUN_AS_NODE: '1',
		SEMLIX_VERIFY_TEMP_DIR: temporaryDirectory
	},
	stdio: 'inherit'
});

try {
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exitCode = result.status ?? 1;
	}
} finally {
	fs.rmSync(temporaryDirectory, { recursive: true });
}
