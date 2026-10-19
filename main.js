const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { PosPrinter } = require('electron-pos-printer');

let mainWindow = null;
let splashWindow = null;
let nextServer = null;
let nextApplication = null;
let networkConfig = null;
let networkConfigWindow = null;
const NETWORK_PORT = 9002;

function getNetworkInfo() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) for (const entry of list || []) {
    if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
  }
  return { addresses: [...new Set(addresses)].sort(), port: NETWORK_PORT };
}
function readNetworkConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'network.json'), 'utf8'));
    if (value?.mode === 'server') return { mode: 'server' };
    if (value?.mode === 'client' && /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(String(value.serverIp || ''))) return { mode: 'client', serverIp: value.serverIp };
  } catch {}
  return null;
}
function openNetworkConfigWindow() {
  return new Promise((resolve, reject) => {
    networkConfigWindow = new BrowserWindow({ width: 560, height: 620, resizable: false, minimizable: false, maximizable: false, title: 'POSVEN Pro — Configuración de cajas', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true } });
    let settled = false;
    ipcMain.once('network-config-saved', (_event, value) => { if (!settled) { settled = true; resolve(value); } });
    networkConfigWindow.on('closed', () => { networkConfigWindow = null; if (!settled) reject(new Error('Debe configurar esta caja como servidor o conectarla a un servidor.')); });
    networkConfigWindow.loadFile(path.join(__dirname, 'electron/network-config.html'));
  });
}
async function ensureNetworkConfig() {
  const existing = readNetworkConfig(); if (existing) return existing;
  const chosen = await openNetworkConfigWindow();
  if (!chosen || !['server', 'client'].includes(chosen.mode)) throw new Error('Configuración de red no válida.');
  const config = chosen.mode === 'server' ? { mode: 'server' } : { mode: 'client', serverIp: String(chosen.serverIp || '').trim() };
  if (config.mode === 'client' && !/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(config.serverIp)) throw new Error('La IP del servidor no es válida.');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'network.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

function fatalError(title, detail) {
  try {
    dialog.showErrorBox(title, detail);
  } catch (e) {
    console.error('[FATAL]', title, detail);
  }
}

function showSplash() {
  try {
    splashWindow = new BrowserWindow({
      width: 420,
      height: 280,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      backgroundColor: '#E6E1D3',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    const splashHtml = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;background:#E6E1D3;font-family:system-ui,sans-serif;color:#1f2937;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
  .logo{font-size:34px;font-weight:900;letter-spacing:1px}
  .sub{font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:2px}
  .bar{width:220px;height:6px;background:rgba(0,0,0,.08);border-radius:3px;overflow:hidden;margin-top:8px}
  .bar::before{content:"";display:block;width:40%;height:100%;background:linear-gradient(90deg,transparent,#6366f1,transparent);animation:slide 1.2s linear infinite}
  @keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
</style></head><body>
  <div class="logo">PosVEN Pro</div>
  <div class="sub">Cargando sistema…</div>
  <div class="bar"></div>
</body></html>`)}`;
    splashWindow.loadURL(splashHtml);
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (e) {
    console.warn('No se pudo mostrar splash:', e);
  }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function createWindow(targetUrl) {
  closeSplash();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    icon: path.join(__dirname, 'public/posven-logo.png'),
    title: 'PosVEN Pro - Punto de Venta',
    show: false,
    backgroundColor: '#E6E1D3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const appUrl = isDev ? 'http://localhost:9002' : targetUrl;
  mainWindow.loadURL(appUrl).catch((err) => {
    fatalError('Error cargando POSVEN-PRO3', String(err));
  });

  const readyTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      showSplash();
    }
  }, 1500);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(readyTimeout);
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('did-fail-load:', errorCode, errorDescription, validatedURL);
    if (errorCode !== -3) {
      fatalError('No se pudo cargar la app', `${errorDescription} (código ${errorCode})\nURL: ${validatedURL}`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details);
    fatalError(
      'La app se cerró inesperadamente',
      `Motivo: ${details.reason || 'desconocido'}\nCódigo: ${details.exitCode ?? 'n/a'}\n\nSi el problema persiste, contacta a soporte.`
    );
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('🖥️ Renderizado:', message);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (!isDev) {
    mainWindow.setMenu(null);
    autoUpdater.checkForUpdatesAndNotify().catch(err => console.error('Update error:', err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startLocalNextServer() {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.POSVEN_SQLITE_PATH = path.join(dataDir, 'posven.sqlite');

  const next = require('next');
  nextApplication = next({ dev: false, dir: app.getAppPath() });
  await nextApplication.prepare();

  const handler = nextApplication.getRequestHandler();
  nextServer = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(NETWORK_PORT, '0.0.0.0', resolve);
  });
  const address = nextServer.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo abrir el servidor local de POSVEN-PRO3.');
  return address.port;
}

app.whenReady().then(async () => {
  try {
    networkConfig = await ensureNetworkConfig();
    if (app.isPackaged && networkConfig.mode === 'server') {
      await startLocalNextServer();
      const urls = getNetworkInfo().addresses.map(ip => `http://${ip}:${NETWORK_PORT}`);
      createWindow(`http://127.0.0.1:${NETWORK_PORT}`);
      if (urls.length) setTimeout(() => { if (!mainWindow?.isDestroyed()) dialog.showMessageBox(mainWindow, { type: 'info', title: 'Servidor POSVEN Pro activo', message: 'Esta PC es el servidor de las cajas.', detail: `Las otras cajas deben conectarse a una de estas direcciones:\n\n${urls.join('\n')}\n\nPuerto: ${NETWORK_PORT}\nMantenga esta PC encendida y conectada a la misma red.`, buttons: ['Entendido'] }); }, 1200);
    } else if (app.isPackaged) createWindow(`http://${networkConfig.serverIp}:${NETWORK_PORT}`);
    else createWindow('http://localhost:9002');

    app.on('activate', () => {
      if (mainWindow === null || BrowserWindow.getAllWindows().length === 0) {
        if (app.isPackaged && networkConfig?.mode === 'server' && nextServer?.address()) createWindow(`http://127.0.0.1:${NETWORK_PORT}`);
        else if (app.isPackaged && networkConfig?.mode === 'client') createWindow(`http://${networkConfig.serverIp}:${NETWORK_PORT}`);
        else createWindow('http://localhost:9002');
      }
    });
  } catch (error) {
    fatalError('No se pudo iniciar POSVEN-PRO3', String(error));
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    try { nextServer.close(); } catch {}
    nextServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Lógica de Impresión Térmica
ipcMain.on('print-ticket', (event, printData) => {
  const options = {
    preview: false,
    width: '80mm',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    printerName: 'Roccia RC-8002',
    timeOutPerLine: 400,
    silent: true,
  };

  PosPrinter.print(printData, options)
    .then(() => {
      console.log('✅ Impresión completada en Roccia RC-8002');
    })
    .catch((error) => {
      console.error('❌ Error de hardware en Roccia:', error);
    });
});

// Exponer versión de la app
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-network-info', () => getNetworkInfo());
ipcMain.handle('save-network-config', async (_event, config) => {
  if (!config || !['server', 'client'].includes(config.mode)) throw new Error('Seleccione servidor o cliente.');
  const normalized = config.mode === 'server' ? { mode: 'server' } : { mode: 'client', serverIp: String(config.serverIp || '').trim() };
  if (normalized.mode === 'client' && !/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(normalized.serverIp)) throw new Error('Introduzca una dirección IPv4 válida.');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'network.json'), JSON.stringify(normalized, null, 2), { mode: 0o600 });
  ipcMain.emit('network-config-saved', null, normalized);
  if (networkConfigWindow && !networkConfigWindow.isDestroyed()) networkConfigWindow.close();
  return { ok: true };
});