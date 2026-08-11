const fs = require('node:fs');
const path = require('node:path');

const projectDirectory = path.resolve(__dirname, '..');
const requiredFiles = [
	'imgs/icons/semlix-icon.ico',
	'imgs/icons/png/icon-512x512.png'
];

for (const relativePath of requiredFiles) {
	const absolutePath = path.join(projectDirectory, relativePath);
	if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
		throw new Error(`Missing required release input: ${relativePath}`);
	}
}

console.log('Release inputs are ready.');
