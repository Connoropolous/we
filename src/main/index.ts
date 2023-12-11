/* eslint-disable @typescript-eslint/no-var-requires */
import {
  app,
  BrowserWindow,
  ipcMain,
  IpcMainInvokeEvent,
  net,
  Tray,
  Menu,
  nativeImage,
  protocol,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as childProcess from 'child_process';
import url from 'url';
import { createHash } from 'crypto';
import { ArgumentParser } from 'argparse';
import { is } from '@electron-toolkit/utils';
import contextMenu from 'electron-context-menu';

import { AppAssetsInfo, WeFileSystem } from './filesystem';
import { WeRustHandler, ZomeCallUnsignedNapi } from 'hc-we-rust-utils';
// import { AdminWebsocket } from '@holochain/client';
import { LauncherEmitter } from './launcherEmitter';
import { HolochainManager } from './holochainManager';
import { setupLogs } from './logs';
import { DEFAULT_APPS_DIRECTORY, ICONS_DIRECTORY } from './paths';
import { setLinkOpenHandlers } from './utils';
import { createHappWindow } from './windows';
import { APPSTORE_APP_ID } from './sharedTypes';
import { nanoid } from 'nanoid';
import { APPLET_DEV_TMP_FOLDER_PREFIX, validateArgs } from './cli';
import { launch } from './launch';

const rustUtils = require('hc-we-rust-utils');

// https://github.com/nodeca/argparse/issues/128
if (app.isPackaged) {
  process.argv.splice(1, 0, 'placeholder');
}

const parser = new ArgumentParser({
  description: 'Lightningrodlabs We',
});
parser.add_argument('-p', '--profile', {
  help: 'Opens We with a custom profile instead of the default profile.',
  type: 'str',
});
parser.add_argument('-n', '--network-seed', {
  help: 'Installs AppStore with the provided network seed in case AppStore has not been installed yet.',
  type: 'str',
});
parser.add_argument('-c', '--dev-config', {
  help: 'Pass the path to the dev config file to run We in applet dev mode according to the config file.',
  type: 'str',
});
parser.add_argument('--agent-num', {
  help: 'Agent number (related to the dev config file).',
  type: 'int',
});
parser.add_argument('-b', '--bootstrap-url', {
  help: 'URL of the bootstrap server to use. Must be provided if running in applet dev mode with the --dev-config argument.',
  type: 'string',
});
parser.add_argument('-s', '--signaling-url', {
  help: 'URL of the signaling server to use. Must be provided if running in applet dev mode with the --dev-config argument.',
  type: 'string',
});
parser.add_argument('--force-production-urls', {
  help: 'Allow to use production URLs of bootstrap and singaling servers during applet development. It is recommended to use hc-local-services tp spin up a local bootstrap and signaling server during development instead.',
});

const args = parser.parse_args();

export const [PROFILE, APPSTORE_NETWORK_SEED, WE_APPLET_DEV_INFO, BOOTSTRAP_URL, SIGNALING_URL] =
  validateArgs(args, app);

// import * as rustUtils from 'hc-we-rust-utils';

// app.commandLine.appendSwitch('enable-logging');

const appName = app.getName();

if (process.env.NODE_ENV === 'development') {
  console.log('APP IS RUN IN DEVELOPMENT MODE');
  app.setName(appName + '-dev');
}

contextMenu({
  showSaveImageAs: true,
  showSearchWithGoogle: false,
});

console.log('APP PATH: ', app.getAppPath());
console.log('RUNNING ON PLATFORM: ', process.platform);

// const isFirstInstance = app.requestSingleInstanceLock();

// if (!isFirstInstance) {
//   app.quit();
// }

// app.on('second-instance', () => {
//   createOrShowMainWindow();
// });

if (WE_APPLET_DEV_INFO) {
  // garbage collect previously used folders
  const files = fs.readdirSync(os.tmpdir());
  const foldersToDelete = files.filter((file) =>
    file.startsWith(`${APPLET_DEV_TMP_FOLDER_PREFIX}-agent-${WE_APPLET_DEV_INFO.agentNum}`),
  );
  for (const folder of foldersToDelete) {
    fs.rmSync(path.join(os.tmpdir(), folder), { recursive: true, force: true, maxRetries: 4 });
  }
}

const WE_FILE_SYSTEM = WeFileSystem.connect(
  app,
  PROFILE,
  WE_APPLET_DEV_INFO ? WE_APPLET_DEV_INFO.tempDir : undefined,
);

const launcherEmitter = new LauncherEmitter();

const APPLET_IFRAME_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../applet-iframe/index.mjs'),
  'utf-8',
);

setupLogs(launcherEmitter, WE_FILE_SYSTEM);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'applet',
    privileges: { standard: true, supportFetchAPI: true },
  },
]);

let WE_RUST_HANDLER: WeRustHandler | undefined;
// let ADMIN_WEBSOCKET: AdminWebsocket | undefined;
// let ADMIN_PORT: number | undefined;
// let APP_PORT: number | undefined;
let HOLOCHAIN_MANAGER: HolochainManager | undefined;
let LAIR_HANDLE: childProcess.ChildProcessWithoutNullStreams | undefined;
let MAIN_WINDOW: BrowserWindow | undefined | null;
let SPLASH_SCREEN_WINDOW: BrowserWindow | undefined;

const handleSignZomeCall = (_e: IpcMainInvokeEvent, zomeCall: ZomeCallUnsignedNapi) => {
  if (!WE_RUST_HANDLER) throw Error('Rust handler is not ready');
  return WE_RUST_HANDLER.signZomeCall(zomeCall);
};

// // Handle creating/removing shortcuts on Windows when installing/uninstalling.
// if (require('electron-squirrel-startup')) {
//   app.quit();
// }

const createSplashscreenWindow = (): BrowserWindow => {
  // Create the browser window.
  const splashWindow = new BrowserWindow({
    height: 450,
    width: 800,
    center: true,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#331ead',
    // use these settings so that the ui
    // can listen for status change events
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/splashscreen.js'),
    },
  });

  // // and load the splashscreen.html of the app.
  // if (app.isPackaged) {
  //   splashWindow.loadFile(SPLASH_FILE);
  // } else {
  //   // development
  //   splashWindow.loadURL(`${DEVELOPMENT_UI_URL}/splashscreen.html`);
  // }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    splashWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/splashscreen.html`);
  } else {
    splashWindow.loadFile(path.join(__dirname, '../renderer/splashscreen.html'));
  }

  // once its ready to show, show
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
  return splashWindow;
};

const createOrShowMainWindow = () => {
  if (MAIN_WINDOW) {
    MAIN_WINDOW.show();
    return;
  }
  // Create the browser window.
  let mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/admin.js'),
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  console.log('Creating main window');

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // // and load the index.html of the app.
  // if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  //   mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  // } else {
  //   mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  // }

  setLinkOpenHandlers(mainWindow);

  // once its ready to show, show
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => {
    // mainWindow = null;
    MAIN_WINDOW = null;
  });
  MAIN_WINDOW = mainWindow;
};

let tray;
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  console.log('BEING RUN IN __dirnmane: ', __dirname);
  const icon = nativeImage.createFromPath(path.join(ICONS_DIRECTORY, '16x16.png'));
  tray = new Tray(icon);

  protocol.handle('applet', async (request) => {
    // console.log('### Got applet request: ', request);
    // console.log('### Got request with url: ', request.url);
    const uriWithoutProtocol = request.url.split('://')[1];
    const uriWithoutQueryString = uriWithoutProtocol.split('?')[0];
    const uriComponents = uriWithoutQueryString.split('/');
    const lowerCasedAppletId = uriComponents[0].replaceAll('%24', '$');

    const installedAppId = `applet#${lowerCasedAppletId}`;

    const uiAssetsDir = WE_FILE_SYSTEM.appUiAssetsDir(installedAppId);

    if (!uiAssetsDir) {
      throw new Error(`Failed to find UI assets directory for requested applet assets.`);
    }

    if (
      uriComponents.length === 1 ||
      (uriComponents.length === 2 && (uriComponents[1] === '' || uriComponents[1] === 'index.html'))
    ) {
      const indexHtmlResponse = await net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, 'index.html')).toString(),
      );

      const content = await indexHtmlResponse.text();

      // lit uses the $` combination (https://github.com/lit/lit/issues/4433) so string replacement
      // needs to happen a bit cumbersomely
      const htmlComponents = content.split('<head>');
      htmlComponents.splice(1, 0, '<head>');
      htmlComponents.splice(2, 0, `<script type="module">${APPLET_IFRAME_SCRIPT}</script>`);
      let modifiedContent = htmlComponents.join('');

      // remove title attribute to be able to set title to app id later
      modifiedContent = modifiedContent.replace(/<title>.*?<\/title>/i, '');
      const response = new Response(modifiedContent, indexHtmlResponse);
      return response;
    } else {
      return net.fetch(
        url.pathToFileURL(path.join(uiAssetsDir, ...uriComponents.slice(1))).toString(),
      );
    }
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      type: 'normal',
      click() {
        createOrShowMainWindow();
      },
    },
    {
      label: 'Quit',
      type: 'normal',
      click() {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Holochain Launcher');
  tray.setContextMenu(contextMenu);

  ipcMain.handle('sign-zome-call', handleSignZomeCall);
  ipcMain.handle('open-app', async (_e, appId: string) =>
    createHappWindow(appId, WE_FILE_SYSTEM, HOLOCHAIN_MANAGER!.appPort),
  );
  ipcMain.handle(
    'install-app',
    async (_e, filePath: string, appId: string, networkSeed: string) => {
      if (filePath === '#####REQUESTED_KANDO_INSTALLATION#####') {
        console.log('Got request to install KanDo.');
        filePath = path.join(DEFAULT_APPS_DIRECTORY, 'kando.webhapp');
      }
      if (!appId || appId === '') {
        throw new Error('No app id provided.');
      }
      await HOLOCHAIN_MANAGER!.installApp(filePath, appId, networkSeed);
    },
  );
  ipcMain.handle('is-applet-dev', (_e) => !!WE_APPLET_DEV_INFO);
  // ipcMain.handle('uninstall-app', async (_e, appId: string) => {
  //   await HOLOCHAIN_MANAGER!.uninstallApp(appId);
  // });
  ipcMain.handle('get-applet-dev-port', (_e, appId: string) => {
    const appAssetsInfo = WE_FILE_SYSTEM.readAppAssetsInfo(appId);
    if (appAssetsInfo.type === 'webhapp' && appAssetsInfo.ui.location.type === 'localhost') {
      return appAssetsInfo.ui.location.port;
    }
    return undefined;
  });
  ipcMain.handle('get-applet-iframe-script', () => {
    return APPLET_IFRAME_SCRIPT;
  });
  ipcMain.handle('get-installed-apps', async () => {
    return HOLOCHAIN_MANAGER!.installedApps;
  });
  ipcMain.handle('get-conductor-info', async () => {
    return {
      app_port: HOLOCHAIN_MANAGER!.appPort,
      admin_port: HOLOCHAIN_MANAGER!.adminPort,
      appstore_app_id: APPSTORE_APP_ID,
    };
  });
  ipcMain.handle('lair-setup-required', async () => {
    return !WE_FILE_SYSTEM.keystoreInitialized();
  });
  ipcMain.handle('join-group', async (_e, networkSeed: string) => {
    const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
    const hash = createHash('sha256');
    hash.update(networkSeed);
    const hashedSeed = hash.digest('base64');
    const appId = `group#${hashedSeed}`;
    console.log('Determined appId for group: ', appId);
    if (apps.map((appInfo) => appInfo.installed_app_id).includes(appId)) {
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      return;
    }
    const appStoreAppInfo = apps.find((appInfo) => appInfo.installed_app_id === APPSTORE_APP_ID);
    if (!appStoreAppInfo)
      throw new Error('Appstore must be installed before installing the first group.');
    const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
      path: path.join(DEFAULT_APPS_DIRECTORY, 'we.happ'),
      installed_app_id: appId,
      agent_key: appStoreAppInfo.agent_pub_key,
      network_seed: networkSeed,
      membrane_proofs: {},
    });
    await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
    return appInfo;
  });
  ipcMain.handle(
    'install-applet-bundle',
    async (
      _e,
      appId: string,
      networkSeed: string,
      membraneProofs,
      agentPubKey,
      happOrWebHappUrl: string,
      metadata?: string,
    ) => {
      console.log('INSTALLING APPLET BUNDLE. metadata: ', metadata);
      const apps = await HOLOCHAIN_MANAGER!.adminWebsocket.listApps({});
      const alreadyInstalled = apps.find((appInfo) => appInfo.installed_app_id === appId);
      if (alreadyInstalled) {
        await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
        return;
      }
      // fetch webhapp from URL
      console.log('Fetching happ/webhapp from URL: ', happOrWebHappUrl);
      const response = await net.fetch(happOrWebHappUrl);
      const buffer = await response.arrayBuffer();
      const tmpDir = path.join(os.tmpdir(), `we-applet-${nanoid(8)}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const webHappPath = path.join(tmpDir, 'applet_to_install.webhapp');
      fs.writeFileSync(webHappPath, new Uint8Array(buffer));

      const uisDir = path.join(WE_FILE_SYSTEM.uisDir);
      const happsDir = path.join(WE_FILE_SYSTEM.happsDir);

      const result: string = await rustUtils.saveHappOrWebhapp(webHappPath, uisDir, happsDir);

      const [happFilePath, happHash, uiHash, webHappHash] = result.split('$');

      const appInfo = await HOLOCHAIN_MANAGER!.adminWebsocket.installApp({
        path: happFilePath,
        installed_app_id: appId,
        agent_key: agentPubKey,
        network_seed: networkSeed,
        membrane_proofs: membraneProofs,
      });
      await HOLOCHAIN_MANAGER!.adminWebsocket.enableApp({ installed_app_id: appId });
      // TODO Store more app metadata
      // Store app metadata
      let uiPort: number | undefined;
      if (metadata) {
        try {
          const metadataObject = JSON.parse(metadata);
          if (metadataObject.uiPort) {
            uiPort = metadataObject.uiPort;
          }
        } catch (e) {}
      }
      const appAssetsInfo: AppAssetsInfo = webHappHash
        ? {
            type: 'webhapp',
            sha256: webHappHash,
            source: {
              type: 'https',
              url: happOrWebHappUrl,
            },
            happ: {
              sha256: happHash,
            },
            ui: {
              location: {
                type: 'filesystem',
                sha256: uiHash,
              },
            },
          }
        : uiPort
          ? {
              type: 'webhapp',
              source: {
                type: 'https',
                url: happOrWebHappUrl,
              },
              happ: {
                sha256: happHash,
              },
              ui: {
                location: {
                  type: 'localhost',
                  port: uiPort,
                },
              },
            }
          : {
              type: 'happ',
              sha256: happHash,
              source: {
                type: 'https',
                url: happOrWebHappUrl,
              },
            };
      fs.writeFileSync(
        path.join(WE_FILE_SYSTEM.appsDir, `${appId}.json`),
        JSON.stringify(appAssetsInfo, undefined, 4),
      );
      console.log('@ipcHandler: stored AppAssetsInfo: ', appAssetsInfo);
      // remove temp dir again
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log('@install-applet-bundle: app installed.');
      return appInfo;
    },
  );
  ipcMain.handle('launch', async (_e, password) => {
    // const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // await delay(5000);
    [LAIR_HANDLE, HOLOCHAIN_MANAGER, WE_RUST_HANDLER] = await launch(
      WE_FILE_SYSTEM,
      launcherEmitter,
      SPLASH_SCREEN_WINDOW,
      password,
    );

    if (SPLASH_SCREEN_WINDOW) SPLASH_SCREEN_WINDOW.close();
    createOrShowMainWindow();
  });

  if (WE_APPLET_DEV_INFO) {
    [LAIR_HANDLE, HOLOCHAIN_MANAGER, WE_RUST_HANDLER] = await launch(
      WE_FILE_SYSTEM,
      launcherEmitter,
      undefined,
      'dummy-dev-password :)',
    );
    createOrShowMainWindow();
  } else {
    SPLASH_SCREEN_WINDOW = createSplashscreenWindow();
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createOrShowMainWindow();
  }
});

app.on('quit', () => {
  if (LAIR_HANDLE) {
    LAIR_HANDLE.kill();
  }
  if (HOLOCHAIN_MANAGER) {
    HOLOCHAIN_MANAGER.processHandle.kill();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
