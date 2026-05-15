const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const os = require('os');

const BIN_DIR = path.join(__dirname, '..', 'bin');
// Output binary name follows the *host* platform when run locally; for Docker
// cross-builds the file just needs to be present and executable inside the image.
const OUT_NAME = (process.env.TARGET_PLATFORM || os.platform()) === 'win32' ? 'obscura.exe' : 'obscura';
const OBSCURA_PATH = path.join(BIN_DIR, OUT_NAME);

if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

function getAssetName() {
  const platform = process.env.TARGET_PLATFORM || os.platform();
  let arch = process.env.TARGET_ARCH || os.arch();
  // Docker buildx exposes TARGETARCH as `amd64`/`arm64`; map to Node's arch names.
  if (arch === 'amd64') arch = 'x64';
  if (arch === 'aarch64') arch = 'arm64';

  if (platform === 'win32') {
    return 'obscura-x86_64-windows.zip';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'obscura-aarch64-macos.tar.gz' : 'obscura-x86_64-macos.tar.gz';
  }
  if (platform === 'linux') {
    if (arch === 'arm64') {
      // Upstream obscura releases don't ship a linux-aarch64 build today.
      // Run without it — the app boots; only /api/import/link is degraded.
      console.warn('[obscura] no linux-arm64 binary upstream; share-link import will be disabled in this image.');
      return null;
    }
    return 'obscura-x86_64-linux.tar.gz';
  }
  console.error('Unsupported platform:', platform);
  process.exit(1);
}

async function downloadAndExtract() {
  if (fs.existsSync(OBSCURA_PATH)) {
    console.log(`Obscura binary already exists at ${OBSCURA_PATH}. Skipping download.`);
    return;
  }

  const assetName = getAssetName();
  if (!assetName) return;

  const url = `https://github.com/h4ckf0r0day/obscura/releases/latest/download/${assetName}`;
  const isZip = assetName.endsWith('.zip');
  const tempFile = path.join(BIN_DIR, isZip ? 'obscura.zip' : 'obscura.tar.gz');

  console.log(`Downloading Obscura from ${url}...`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Graceful degrade for cross-arch Docker builds where the asset may be missing.
      console.warn(`[obscura] download failed: HTTP ${response.status}. Share-link import will be disabled.`);
      return;
    }

    const fileStream = fs.createWriteStream(tempFile);
    const { Readable } = require('stream');
    await new Promise((resolve, reject) => {
      Readable.fromWeb(response.body)
        .pipe(fileStream)
        .on('finish', resolve)
        .on('error', reject);
    });

    console.log('Extracting...');
    if (isZip) {
      child_process.execSync(`tar -xf "${tempFile}" -C "${BIN_DIR}"`, { stdio: 'inherit' });
    } else {
      child_process.execSync(`tar -xzf "${tempFile}" -C "${BIN_DIR}"`, { stdio: 'inherit' });
    }

    fs.unlinkSync(tempFile);

    if ((process.env.TARGET_PLATFORM || os.platform()) !== 'win32' && fs.existsSync(OBSCURA_PATH)) {
      fs.chmodSync(OBSCURA_PATH, '755');
    }

    console.log('Obscura downloaded and extracted successfully.');
  } catch (error) {
    console.warn('[obscura] download error (non-fatal):', error?.message ?? error);
  }
}

downloadAndExtract();
