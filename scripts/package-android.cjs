const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { copyWebAssets } = require('./web-assets.cjs');

const project = path.join(__dirname, '..');
const build = path.join(project, '.android-build');
const web = path.join(build, 'assets');
const native = path.join(project, 'mobile', 'android');
const policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src blob: data:; worker-src 'self' blob:; connect-src 'self' blob:; frame-src blob:; base-uri 'none'; form-action 'none'";
copyWebAssets(project, web, { legacyPDF: true });
for (const name of ['mobile.css', 'mobile.mjs', 'reading-clock.mjs']) {
  fs.copyFileSync(path.join(project, 'mobile', name), path.join(web, name));
}
const entry = path.join(web, 'index.html');
fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8')
  .replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`)
  .replace('</head>', '  <link rel="stylesheet" href="mobile.css">\n</head>')
  .replace('<body>', '<body data-mobile data-screen="shelf">'));
const pdfCSS = path.join(web, 'vendor', 'pdfjs', 'web', 'pdf_viewer.css');
const css = fs.readFileSync(pdfCSS, 'utf8').replaceAll(':root', ':scope');
fs.writeFileSync(pdfCSS, `@scope (leaf-pdf-view) {\n${css}\n}\n`);
if (process.argv.includes('--assets-only')) {
  console.log(web);
  process.exit(0);
}

const javaHome = process.env.LEAF_JDK_HOME || process.env.JAVA_HOME;
const sdkHome = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
const platform = process.env.LEAF_ANDROID_PLATFORM ||
  (sdkHome && path.join(sdkHome, 'platforms', 'android-36', 'android.jar'));
const tools = process.env.LEAF_ANDROID_BUILD_TOOLS ||
  (sdkHome && path.join(sdkHome, 'build-tools', '36.0.0'));
if (!javaHome || !platform || !tools) {
  throw new Error('Set JAVA_HOME and ANDROID_SDK_ROOT for JDK 17 and Android SDK 36.');
}

const suffix = process.platform === 'win32' ? '.exe' : '';
const java = name => path.join(javaHome, 'bin', name + suffix);
const android = name => path.join(tools, name + suffix);
const out = name => path.join(build, name);
const run = (program, args, cwd = project) => execFileSync(program, args, { stdio: 'inherit', cwd });
fs.mkdirSync(out('classes'), { recursive: true });
run(java('javac'), ['-encoding', 'UTF-8', '--release', '11', '-classpath', platform,
  '-d', out('classes'), path.join(native, 'MainActivity.java')]);
run(java('jar'), ['cf', out('classes.jar'), '-C', out('classes'), '.']);
run(java('java'), ['-cp', path.join(tools, 'lib', 'd8.jar'), 'com.android.tools.r8.D8',
  '--release', '--min-api', '29', '--lib', platform, '--output', build, out('classes.jar')]);
// Android's Windows resource tools need an ASCII working path.
const tempRoot = fs.realpathSync(os.tmpdir());
const stage = fs.mkdtempSync(path.join(tempRoot, 'leaf-apk-'));
try {
  fs.cpSync(path.join(native, 'res'), path.join(stage, 'res'), { recursive: true });
  fs.cpSync(web, path.join(stage, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(native, 'AndroidManifest.xml'), path.join(stage, 'AndroidManifest.xml'));
  fs.copyFileSync(platform, path.join(stage, 'android.jar'));
  for (const tool of ['aapt2', 'zipalign']) fs.copyFileSync(android(tool), path.join(stage, tool + suffix));
  run(path.join(stage, 'aapt2' + suffix), ['compile', '--dir', 'res', '-o', 'resources.zip'], stage);
  run(path.join(stage, 'aapt2' + suffix), ['link', '-I', 'android.jar', '--manifest', 'AndroidManifest.xml',
    '-o', 'unsigned.apk', 'resources.zip'], stage);
  // Use jar for assets so nested entry paths use forward slashes on Windows.
  run(java('jar'), ['uf', 'unsigned.apk', '-C', stage, 'assets', '-C', build, 'classes.dex'], stage);
  run(path.join(stage, 'zipalign' + suffix), ['-f', '4', 'unsigned.apk', 'aligned.apk'], stage);
  fs.copyFileSync(path.join(stage, 'aligned.apk'), out('aligned.apk'));
} finally {
  const resolved = fs.realpathSync(stage);
  if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('leaf-apk-')) {
    fs.rmSync(resolved, { recursive: true });
  }
}

const key = out('leaf-test.jks');
if (!fs.existsSync(key)) {
  run(java('keytool'), ['-genkeypair', '-keystore', key, '-storepass', 'android',
    '-keypass', 'android', '-alias', 'leaf-test', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-dname', 'CN=LeafReader local test']);
}
const manifest = fs.readFileSync(path.join(native, 'AndroidManifest.xml'), 'utf8');
const version = manifest.match(/android:versionName="([\d.]+)"/)?.[1];
if (!version) throw new Error('Android version is missing from the manifest.');
const release = path.join(project, 'release', `LeafReader-${version}-android.apk`);
fs.mkdirSync(path.dirname(release), { recursive: true });
const signer = path.join(tools, 'lib', 'apksigner.jar');
run(java('java'), ['-jar', signer, 'sign', '--ks', key, '--ks-pass', 'pass:android',
  '--v4-signing-enabled', 'false', '--out', release, out('aligned.apk')]);
run(java('java'), ['-jar', signer, 'verify', '--verbose', release]);
const entries = execFileSync(java('jar'), ['tf', release], { encoding: 'utf8' }).split(/\r?\n/);
if (entries.some(entry => entry.includes('\\')) ||
    !entries.includes('assets/vendor/pdfjs/build/pdf.worker.mjs')) {
  throw new Error('Invalid Android asset entry paths');
}
console.log(release);
