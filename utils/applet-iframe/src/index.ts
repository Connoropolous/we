import { ProfilesClient } from '@holochain-open-dev/profiles';
import { EntryHashMap, HoloHashMap, parseHrl } from '@holochain-open-dev/utils';
import {
  ActionHash,
  AppAgentClient,
  AppAgentWebsocket,
  CallZomeRequest,
  CallZomeRequestSigned,
  EntryHash,
  HoloHashB64,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import { decode } from '@msgpack/msgpack';
import { toUint8Array } from 'js-base64';
import {
  WeServices,
  IframeConfig,
  AttachmentType,
  Hrl,
  HrlWithContext,
  WeNotification,
  RenderView,
  RenderInfo,
  AppletToParentRequest,
  AppletToParentMessage,
  InternalAttachmentType,
  HrlLocation,
  ParentToAppletRequest,
  AttachmentName,
  AppletHash,
  AppletId,
  AppletServices,
  OpenHrlMode,
} from '@lightningrodlabs/we-applet';

declare global {
  interface Window {
    __WE_API__: WeServices;
    __WE_APPLET_SERVICES__: AppletServices;
    __WE_RENDER_INFO__: RenderInfo;
    __WE_APPLET_HASH__: AppletHash;
  }
}

const weApi: WeServices = {
  attachmentTypes: new HoloHashMap() as ReadonlyMap<
    AppletHash,
    Record<AttachmentName, AttachmentType>
  >,

  openAppletMain: async (appletHash: EntryHash): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'applet-main',
        appletHash,
      },
    }),

  openAppletBlock: async (appletHash, block: string, context: any): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'applet-block',
        appletHash,
        block,
        context,
      },
    }),

  openCrossAppletMain: (appletBundleId: ActionHash): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'cross-applet-main',
        appletBundleId,
      },
    }),

  openCrossAppletBlock: (appletBundleId: ActionHash, block: string, context: any): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'cross-applet-block',
        appletBundleId,
        block,
        context,
      },
    }),

  openHrl: (hrlWithContext: HrlWithContext, mode?: OpenHrlMode): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'hrl',
        hrlWithContext,
        mode,
      },
    }),

  groupProfile: (groupId) =>
    postMessage({
      type: 'get-group-profile',
      groupId,
    }),

  appletInfo: (appletHash) =>
    postMessage({
      type: 'get-applet-info',
      appletHash,
    }),

  attachableInfo: (hrlWithContext: HrlWithContext) =>
    postMessage({
      type: 'get-global-attachable-info',
      hrlWithContext,
    }),

  hrlToClipboard: (hrlWithContext: HrlWithContext) =>
    postMessage({
      type: 'hrl-to-clipboard',
      hrlWithContext,
    }),

  search: (filter: string) =>
    postMessage({
      type: 'search',
      filter,
    }),

  userSelectHrl: () =>
    postMessage({
      type: 'user-select-hrl',
    }),

  notifyWe: (notifications: Array<WeNotification>) =>
    postMessage({
      type: 'notify-we',
      notifications,
    }),

  userSelectScreen: () =>
    postMessage({
      type: 'user-select-screen',
    }),
};

(async () => {
  window.__WE_APPLET_HASH__ = readAppletHash();
  window.__WE_API__ = weApi;
  window.__WE_APPLET_SERVICES__ = new AppletServices();

  const [_, view] = await Promise.all([fetchLocalStorage(), getRenderView()]);

  if (!view) {
    throw new Error('RenderView undefined.');
  }

  const crossApplet = view ? view.type === 'cross-applet-view' : false;

  const iframeConfig: IframeConfig = await postMessage({
    type: 'get-iframe-config',
    crossApplet,
  });

  if (iframeConfig.type === 'not-installed') {
    renderNotInstalled(iframeConfig.appletName);
    return;
  }

  // add eventlistener for clipboard
  window.addEventListener('keydown', async (zEvent) => {
    if (zEvent.altKey && zEvent.key === 's') {
      // case sensitive
      await postMessage({ type: 'toggle-clipboard' });
    }
  });

  if (view.type === 'applet-view') {
    if (iframeConfig.type !== 'applet') throw new Error('Bad iframe config');

    // message handler for ParentToApplet messages - Only added for applet main-view
    window.addEventListener('message', async (m: MessageEvent<any>) => {
      try {
        const result = await handleMessage(appletClient, appletHash, m.data);
        m.ports[0].postMessage({ type: 'success', result });
      } catch (e) {
        m.ports[0].postMessage({ type: 'error', error: (e as any).message });
      }
    });

    const [profilesClient, appletClient] = await Promise.all([
      setupProfilesClient(
        iframeConfig.appPort,
        iframeConfig.profilesLocation.profilesAppId,
        iframeConfig.profilesLocation.profilesRoleName,
      ),
      setupAppletClient(iframeConfig.appPort, iframeConfig.appletHash),
    ]);

    const appletHash = window.__WE_APPLET_HASH__;

    window.__WE_RENDER_INFO__ = {
      type: 'applet-view',
      view: view.view,
      appletClient,
      profilesClient,
      appletHash,
      groupProfiles: iframeConfig.groupProfiles,
    };
  } else if (view.type === 'cross-applet-view') {
    const applets: EntryHashMap<{
      appletClient: AppAgentClient;
      profilesClient: ProfilesClient;
    }> = new HoloHashMap();

    if (iframeConfig.type !== 'cross-applet') throw new Error('Bad iframe config');

    await Promise.all(
      Object.entries(iframeConfig.applets).map(
        async ([appletId, { profilesAppId, profilesRoleName }]) => {
          const [appletClient, profilesClient] = await Promise.all([
            setupAppletClient(iframeConfig.appPort, decodeHashFromBase64(appletId)),
            setupProfilesClient(iframeConfig.appPort, profilesAppId, profilesRoleName),
          ]);
          applets.set(decodeHashFromBase64(appletId), {
            appletClient,
            profilesClient,
          });
        },
      ),
    );

    window.__WE_RENDER_INFO__ = {
      type: 'cross-applet-view',
      view: view.view,
      applets,
    };
  } else {
    throw new Error('Bad RenderView type.');
  }
  document.dispatchEvent(new CustomEvent('applet-iframe-ready'));

  // get global attachment-types with setTimeout in order not to block subsequent stuff
  setTimeout(async () => {
    const globalAttachmentTypes = await getGlobalAttachmentTypes();
    window.__WE_API__.attachmentTypes = globalAttachmentTypes;
  });
  setTimeout(async () => {
    const globalAttachmentTypes = await getGlobalAttachmentTypes();
    window.__WE_API__.attachmentTypes = globalAttachmentTypes;
  }, 2000);
  setInterval(async () => {
    const globalAttachmentTypes = await getGlobalAttachmentTypes();
    window.__WE_API__.attachmentTypes = globalAttachmentTypes;
  }, 10000);
})();

async function fetchLocalStorage() {
  // override localStorage methods and fetch localStorage for this applet from main window
  overrideLocalStorage();
  const localStorageJson: string | null = await postMessage({ type: 'get-localStorage' });
  const localStorage = localStorageJson ? JSON.parse(localStorageJson) : null;
  if (localStorageJson)
    Object.keys(localStorage).forEach((key) => window.localStorage.setItem(key, localStorage[key]));
}

const handleMessage = async (
  appletClient: AppAgentClient,
  appletHash: AppletHash,
  request: ParentToAppletRequest,
) => {
  switch (request.type) {
    case 'get-applet-attachable-info':
      return window.__WE_APPLET_SERVICES__.getAttachableInfo(
        appletClient,
        request.roleName,
        request.integrityZomeName,
        request.entryType,
        request.hrlWithContext,
      );
    case 'get-applet-attachment-types':
      const types = await window.__WE_APPLET_SERVICES__.attachmentTypes(
        appletClient,
        appletHash,
        window.__WE_API__,
      );

      const internalAttachmentTypes: Record<string, InternalAttachmentType> = {};
      for (const [name, attachmentType] of Object.entries(types)) {
        internalAttachmentTypes[name] = {
          icon_src: attachmentType.icon_src,
          label: attachmentType.label,
        };
      }

      return internalAttachmentTypes;
    case 'get-block-types':
      return window.__WE_APPLET_SERVICES__.blockTypes;
    case 'search':
      return window.__WE_APPLET_SERVICES__.search(
        appletClient,
        appletHash,
        window.__WE_API__,
        request.filter,
      );
    case 'create-attachment':
      const attachments = await window.__WE_APPLET_SERVICES__.attachmentTypes(
        appletClient,
        appletHash,
        window.__WE_API__,
      );
      const postAttachment = attachments[request.attachmentType];
      if (!postAttachment) {
        throw new Error('Necessary attachment type not provided by the applet.');
      }
      try {
        const hrl = await postAttachment.create(request.attachToHrlWithContext);
        return hrl;
      } catch (e) {
        return Promise.reject(
          new Error(
            `Failed to create attachment of type '${
              request.attachmentType
            }' for applet with hash '${encodeHashToBase64(appletHash)}': ${e}`,
          ),
        );
      }
    default:
      throw new Error('Unknown ParentToAppletRequest');
  }
};

async function postMessage(request: AppletToParentRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    const message: AppletToParentMessage = {
      request,
      appletHash: window.__WE_APPLET_HASH__,
    };

    // eslint-disable-next-line no-restricted-globals
    top!.postMessage(message, '*', [channel.port2]);

    channel.port1.onmessage = (m) => {
      if (m.data.type === 'success') {
        resolve(m.data.result);
      } else if (m.data.type === 'error') {
        reject(m.data.error);
      }
    };
  });
}

async function setupAppAgentClient(appPort: number, installedAppId: string) {
  const appletClient = await AppAgentWebsocket.connect(
    new URL(`ws://127.0.0.1:${appPort}`),
    installedAppId,
  );

  window.addEventListener('beforeunload', () => {
    // close websocket connection again to prevent insufficient resources error
    appletClient.appWebsocket.client.close();
  });

  appletClient.appWebsocket.callZome = appletClient.appWebsocket._requester('call_zome', {
    input: async (request) => signZomeCall(request),
    output: (o) => decode(o as any),
  });

  return appletClient;
}

async function setupAppletClient(appPort: number, appletHash: EntryHash): Promise<AppAgentClient> {
  return setupAppAgentClient(appPort, appIdFromAppletHash(appletHash));
}

async function setupProfilesClient(appPort: number, appId: string, roleName: string) {
  const client = await setupAppAgentClient(appPort, appId);

  return new ProfilesClient(client, roleName);
}

async function signZomeCall(request: CallZomeRequest): Promise<CallZomeRequestSigned> {
  return postMessage({ type: 'sign-zome-call', request });
}

function readAppletHash(): EntryHash {
  if (window.origin.startsWith('applet://')) {
    const urlWithoutProtocol = window.origin.split('://')[1].split('/')[0];
    const lowercaseB64IdWithPercent = urlWithoutProtocol.split('?')[0].split('.')[0];
    const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
    return decodeHashFromBase64(toOriginalCaseB64(lowercaseB64Id));
  }
  // In dev mode, the applet hash will be appended at the end
  const lowercaseB64IdWithPercent = window.location.href.split('#')[1];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return decodeHashFromBase64(toOriginalCaseB64(lowercaseB64Id));
}

// IMPORTANT: If this function is changed, the same function in src/renderer/src/utils.ts needs
// to be changed accordingly
function appIdFromAppletHash(appletHash: EntryHash): string {
  return `applet#${toLowerCaseB64(encodeHashToBase64(appletHash))}`;
}

function toLowerCaseB64(hashb64: HoloHashB64): string {
  return hashb64.replace(/[A-Z]/g, (match) => match.toLowerCase() + '$');
}

function toOriginalCaseB64(input: string): HoloHashB64 {
  return input.replace(/[a-z]\$/g, (match) => match[0].toUpperCase());
}

async function getRenderView(): Promise<RenderView | undefined> {
  if (window.location.search.length === 0) return undefined;
  const queryString = window.location.search.slice(1);
  return queryStringToRenderView(queryString);
}

async function getGlobalAttachmentTypes() {
  const attachmentTypes = new HoloHashMap<AppletHash, Record<AttachmentName, AttachmentType>>();
  const internalAttachmentTypes: Record<
    AppletId,
    Record<AttachmentName, InternalAttachmentType>
  > = await postMessage({
    type: 'get-global-attachment-types',
  });

  for (const [appletId, appletAttachmentTypes] of Object.entries(internalAttachmentTypes)) {
    const attachmentTypesForThisApplet: Record<AttachmentName, AttachmentType> = {};
    for (const [name, attachmentType] of Object.entries(appletAttachmentTypes)) {
      attachmentTypesForThisApplet[name] = {
        label: attachmentType.label,
        icon_src: attachmentType.icon_src,
        create: (attachToHrlWithContext) =>
          postMessage({
            type: 'create-attachment',
            request: {
              appletHash: decodeHashFromBase64(appletId),
              attachmentType: name,
              attachToHrlWithContext,
            },
          }),
      };
    }

    attachmentTypes.set(decodeHashFromBase64(appletId), attachmentTypesForThisApplet);
  }

  return attachmentTypes;
}

async function queryStringToRenderView(s: string): Promise<RenderView> {
  const args = s.split('&');

  const view = args[0].split('=')[1] as 'applet-view' | 'cross-applet-view';
  let viewType: string | undefined;
  let block: string | undefined;
  let hrl: Hrl | undefined;
  let context: any | undefined;

  if (args[1]) {
    viewType = args[1].split('=')[1];
  }

  if (args[2] && args[2].split('=')[0] === 'block') {
    block = args[2].split('=')[1];
  }
  if (args[2] && args[2].split('=')[0] === 'hrl') {
    hrl = parseHrl(args[2].split('=')[1]);
  }
  if (args[3] && args[3].split('=')[0] === 'context') {
    context = decode(toUint8Array(args[3].split('=')[1]));
  }

  switch (viewType) {
    case undefined:
      throw new Error('view is undefined');
    case 'main':
      if (view !== 'applet-view' && view !== 'cross-applet-view') {
        throw new Error(`invalid query string: ${s}.`);
      }
      return {
        type: view,
        view: {
          type: 'main',
        },
      };
    case 'block':
      if (view !== 'applet-view' && view !== 'cross-applet-view') {
        throw new Error(`invalid query string: ${s}.`);
      }
      if (!block) throw new Error(`Invalid query string: ${s}. Missing block name.`);
      return {
        type: view,
        view: {
          type: 'block',
          block,
          context,
        },
      };
    case 'attachable':
      if (!hrl) throw new Error(`Invalid query string: ${s}. Missing hrl parameter.`);
      if (view !== 'applet-view') throw new Error(`Invalid query string: ${s}.`);
      const hrlLocation: HrlLocation = await postMessage({
        type: 'get-hrl-location',
        hrl,
      });
      return {
        type: view,
        view: {
          type: 'attachable',
          roleName: hrlLocation.roleName,
          integrityZomeName: hrlLocation.integrityZomeName,
          entryType: hrlLocation.entryType,
          hrlWithContext: { hrl, context },
        },
      };

    default:
      throw new Error(`Invalid query string: ${s}`);
  }
}

function overrideLocalStorage(): void {
  const _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = async function (key, value) {
    if (this === window.localStorage) {
      setTimeout(
        async () =>
          postMessage({
            type: 'localStorage.setItem',
            key,
            value,
          }),
        100,
      );
    }
    _setItem.apply(this, [key, value]);
  };

  const _removeItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = async function (key): Promise<void> {
    if (this === window.localStorage) {
      setTimeout(
        async () =>
          postMessage({
            type: 'localStorage.removeItem',
            key,
          }),
        100,
      );
    }
    _removeItem.apply(this, [key]);
  };

  const _clear = Storage.prototype.clear;
  Storage.prototype.clear = async function (): Promise<void> {
    if (this === window.localStorage) {
      setTimeout(
        async () =>
          postMessage({
            type: 'localStorage.clear',
          }),
        100,
      );
    }
    _clear.apply(this, []);
  };
}

function renderNotInstalled(appletName: string) {
  document.body.innerHTML = `<div
    style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center"
  >
    <span>You don't have the applet ${appletName} installed.</span>
    <span>Install it from the group's home, and refresh this view.</span>
  </div>`;
}
