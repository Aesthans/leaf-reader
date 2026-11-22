const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');
const { copyWebAssets } = require('./web-assets.cjs');

const project = path.join(__dirname, '..');
const runtime = path.join(project, 'node_modules', 'electron', 'dist');
const release = path.join(project, 'release', `LeafReader-${version}-win-x64`);
const appDir = path.join(release, 'resources', 'app');
const executable = path.join(runtime, 'electron.exe');
if (process.platform !== 'win32' || process.arch !== 'x64' || !fs.existsSync(executable)) {
  throw new Error('Run this script on Windows x64 after installing the Electron runtime.');
}

fs.cpSync(runtime, release, {
  recursive: true,
  filter: file => file !== executable && path.basename(file) !== 'default_app.asar'
});
copyWebAssets(project, appDir);
for (const entry of ['main.cjs', 'README.md', 'docs']) {
  fs.cpSync(path.join(project, entry), path.join(appDir, entry), { recursive: true });
}
fs.writeFileSync(path.join(appDir, 'package.json'),
  JSON.stringify({ name: 'leaf-reader', productName: '一页', version, main: 'main.cjs', license: 'MIT' }));

async function writeExecutable() {
  const { Data, NtExecutable, NtExecutableResource, Resource } = await import('resedit');
  const exe = NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (groups.length !== 1) throw new Error('Expected one Electron icon resource group.');
  const { id, lang } = groups[0];
  const icon = Data.IconFile.from(fs.readFileSync(path.join(project, 'assets', 'icon.ico')));
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries, id, lang, icon.icons.map(item => item.data));
  resources.outputResource(exe);
  fs.writeFileSync(path.join(release, 'LeafReader.exe'), Buffer.from(exe.generate()));
  console.log(release);
}

writeExecutable().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
