const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const testPath = path.join(projectRoot, 'tests', 'integration', 'vector-store.test.cjs');
const result = spawnSync(electronPath, ['--test', testPath], {
	cwd: projectRoot,
	env: {
		...process.env,
		ELECTRON_RUN_AS_NODE: '1'
	},
	stdio: 'inherit',
	windowsHide: true
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
