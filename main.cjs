const { app, BrowserWindow, Menu, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const origin = 'leaf://reader';
const policy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data:",
  "font-src blob: data:",
  "media-src blob: data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob:",
  "frame-src blob:",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

protocol.registerSchemesAsPrivileged([{
  scheme: 'leaf',
  privileges: { standard: true, secure: true, supportFetchAPI: true }
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('LeafReader.Desktop');
    const readerSession = session.fromPartition('persist:leaf-reader');
    readerSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    readerSession.setPermissionCheckHandler(() => false);
    readerSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
      (_details, reply) => reply({ cancel: true }));
    readerSession.protocol.handle('leaf', async request => {
      const url = new URL(request.url);
      const name = url.pathname === '/' ? '/index.html' : url.pathname;
      const isAsset = /^\/(?:index\.html|[\w-]+\.mjs|styles\.css|assets\/icon\.svg|vendor\/foliate\/[\w./-]+\.js)$/.test(name);
      const pdfAsset = name.match(/^\/vendor\/pdfjs\/(build\/pdf(?:\.worker)?\.mjs|web\/pdf_viewer\.(?:mjs|css)|(?:web\/images|cmaps|standard_fonts|iccs|wasm)\/[\w.-]+\.(?:svg|png|gif|bcmap|ttf|pfb|icc|wasm|js))$/);
      if (url.host !== 'reader' || (!isAsset && !pdfAsset) || name.split('/').includes('..')) {
        return new Response(null, { status: 404 });
      }
      const file = name === '/reading-clock.mjs' && !app.isPackaged ?
        path.join(__dirname, 'mobile', 'reading-clock.mjs') :
        pdfAsset && !app.isPackaged ?
        path.join(__dirname, 'node_modules', 'pdfjs-dist', pdfAsset[1]) :
        path.join(__dirname, name.slice(1));
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', policy);
      headers.set('X-Content-Type-Options', 'nosniff');
      if (/\.m?js$/.test(name)) headers.set('Content-Type', 'text/javascript; charset=utf-8');
      if (name.endsWith('.svg')) headers.set('Content-Type', 'image/svg+xml');
      if (name.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
      if (name === '/vendor/pdfjs/web/pdf_viewer.css' && response.ok) {
        // Keep the viewer's shared class names out of the bookshelf UI.
        const css = (await response.text()).replaceAll(':root', ':scope');
        headers.delete('Content-Length');
        headers.set('Content-Type', 'text/css; charset=utf-8');
        return new Response(`@scope (leaf-pdf-view) {\n${css}\n}`, { headers });
      }
      return new Response(response.body, { status: response.status, headers });
    });

    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({
      title: '一页 · 电子书阅读器',
      width: 1120,
      height: 780,
      minWidth: 720,
      minHeight: 510,
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      backgroundColor: '#f7f6f1',
      webPreferences: { session: readerSession, sandbox: true, contextIsolation: true }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-frame-navigate', event => {
      if (!event.isMainFrame && event.url.startsWith(`blob:${origin}/`)) return;
      event.preventDefault();
    });
    window.loadURL(`${origin}/`);
  });
  app.on('window-all-closed', () => app.quit());
}
