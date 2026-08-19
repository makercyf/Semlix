<h1>
  Semlix
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</h1>

<img src="/imgs/icons/semlix-icon.svg" width="128" height="128" align="right" alt="Semlix logo">

> Private semantic search for your local email archive

Semlix is a desktop application that indexes `.eml` files and lets you
find messages by exact words or meaning. Email parsing, search indexes,
embeddings, and optional reranking all run on your computer.

<br>

## Features

- Recursively indexes local `.eml` archives without modifying the source files
- Keyword search across senders, subjects, message bodies, and attachment names
- Semantic search powered locally by Transformers.js models
- Optional local reranking for more precise semantic results
- Sender and inclusive date-range filters
- Sortable results that open the original message in its associated application
- Local SQLite, FTS5, and vector storage
- Controls to rebuild semantic data or clear the complete local index
- Native Windows, macOS, and Linux distributions

Semlix does not connect to Gmail, Outlook, IMAP, or any other online mailbox.

## Screenshots

<p align="center">
  <img src="/imgs/main_screen.png" alt="Semlix main screen" width="70%">
</p>

## Download

See the [releases](https://github.com/makercyf/Semlix/releases) page.

## Usage

1. Export or collect your messages as `.eml` files under one directory. Semlix searches the selected directory recursively, so you can organize the files into subdirectories as needed.
2. Start Semlix and choose that directory in the folder picker.
3. Open **Settings**, then click **Index emails** under **Email archive**.
   - The first indexing or semantic-search operation downloads any required model files that are not already cached. Model downloads can require several gigabytes of free disk space.
   - The configured model host receives requests for these model files, but Semlix does not send your email content to the model host.
4. Choose keyword or semantic mode, enter filters, and click **Search**.
5. Double-click the result to open its original `.eml` file.

The index, model cache, configuration, and other application data are stored in the current user's Semlix application-data directory. Clearing indexed data from the application never deletes the source `.eml` files or downloaded models.

## Development

### Requirements

- [Node.js 24 or later](https://nodejs.org/)
- A native C/C++ build environment for native modules such as `better-sqlite3` and `sqlite-vec`
- The target operating system and architecture for native package builds

### Getting Started

Clone the repository and install the locked dependencies:

```bash
git clone https://github.com/makercyf/Semlix.git
cd Semlix
npm ci
```

Start Semlix in development mode:

```bash
npm start
```

On first launch, choose the local `.eml` archive that Semlix should index.

### Build and Test

Build the TypeScript main process and bundled renderer:

```bash
npm run build
```

Run the unit tests:

```bash
npm test
```

## Build Windows Packages

Build the NSIS installer and portable executable:

```powershell
npm run package
```

`npm run package:windows` is the explicit combined command. To build only one
distribution, use `npm run package:installer` or `npm run package:portable`.
Every packaging command validates required release inputs before starting the
build.

The packages are written to `release/`. Configuration is generated in the
user's application-data directory when Semlix first starts.

To create an unpacked application and verify that its native database runtime
loads correctly:

```powershell
npm run package:dir
npm run verify:packaged
```

The Windows GitHub Actions workflow performs the unpacked runtime check, builds
both Windows packages, calculates their SHA-256 hashes, and uploads them with a
`SHA256SUMS.txt` file in one `Semlix-windows-x64` workflow artifact.

## Build macOS and Linux Packages

The macOS commands must run on macOS. Build a DMG for the current architecture:

```bash
npm run package:mac
```

The Linux commands must run on Linux. Build an AppImage for the current
architecture:

```bash
npm run package:linux
```

The macOS and Linux GitHub Actions workflows build x64 and ARM64 packages on
matching native runners. Each job verifies an unpacked application before it
builds and uploads the distributable package with a `SHA256SUMS.txt` file. The
resulting workflow artifacts are `Semlix-macos-x64`, `Semlix-macos-arm64`,
`Semlix-linux-x64`, and `Semlix-linux-arm64`.

Each platform build workflow can be started manually. To prepare a release,
set the version in `package.json`, commit the change, then manually run the
Release workflow from that commit. It builds that exact commit for all three
platforms in parallel, collects all six packages, and creates one
`SHA256SUMS.txt` covering every distributed file. Download the resulting
workflow artifact, then create the version tag and GitHub Release yourself.
Native modules such as `better-sqlite3` and `sqlite-vec` are built and verified on a runner matching
the package's operating system and architecture.

## Security Disclaimer

The executable files and installers distributed by this project are compiled in the GitHub Actions build environment using the source code and build configuration contained in this repository. The build workflow:

1. Installs the locked npm dependencies on the matching Windows, macOS, or Linux runner.
2. Validates the release inputs and builds the TypeScript main process and bundled renderer.
3. Builds and verifies an unpacked Electron application, including its native database runtime.
4. Builds the platform distribution: Windows NSIS installer and portable executable, macOS DMG, or Linux AppImage.
5. Calculates a SHA-256 checksum for every distributed package.
6. Publishes all platform packages with one `SHA256SUMS.txt` manifest as GitHub Release assets.

SHA-256 checksums are provided so that you can verify that a downloaded file has not been modified or corrupted after it was built. A matching checksum confirms file integrity, but it does not guarantee that a file is secure, free from vulnerabilities, or suitable for your environment.

To verify a downloaded release file, open a terminal in the directory that
contains it and calculate its SHA-256 hash with the command for your platform.
The filename patterns work across Semlix versions and architectures:

```powershell
# Windows
Get-FileHash -Algorithm SHA256 -Path ./Semlix-*-windows-*.exe
```

```bash
# macOS
shasum -a 256 ./Semlix-*-mac-*.dmg

# Linux
sha256sum ./Semlix-*-linux-*.AppImage
```

Compare each displayed hash with the corresponding entry in `SHA256SUMS.txt`.

You should not rely solely on checksums, antivirus results, or the fact that a file was built through GitHub Actions. Before running software obtained from another person or project, you are strongly encouraged to review the source code, dependencies, build scripts, and workflow configuration.

If you have security or malware concerns, you can:

- Review the source code and build scripts yourself.
- Use static-analysis tools or an AI-assisted coding agent to help audit the code.
- Review the GitHub Actions workflow and its build logs.
- Scan the downloaded files with reputable security tools.
- Compile the application directly from the reviewed source code by following the build instructions in this README.

Automated or AI-assisted audits can help identify potential issues, but they should not be treated as a substitute for independent security review or professional judgment.

By downloading, building, or running Semlix, you accept responsibility for evaluating whether the software is appropriate for your system and security requirements.

## Privacy

Semlix reads local `.eml` files and stores its index, configuration, and model
cache on your computer. It does not require an account, connect to an online
mailbox, request email-provider credentials, or modify the source archive.

Clicking **Index emails** creates both the keyword and semantic indexes. It
requires the selected embedding model and downloads it from the configured
third-party model host when it is not already cached. Semantic search may also
download the optional reranking model when it is enabled and not cached.

Using keyword search does not communicate with a third party. Model
downloads can reveal technical information such as your IP address and the
requested model, but Semlix does not send email content, search queries, or
indexed data to the model host. Once the required models are cached, indexing
and both search modes run locally.

## Contributing

Contributions are welcome.

When reporting a bug, include the Semlix version, operating system, package
type, and steps to reproduce it. Never attach private email messages, indexes,
databases, model caches, or logs that contain sensitive information.

Before submitting a pull request, run:

```bash
npm ci
npm test
```

## License

This project is licensed under the MIT License.
