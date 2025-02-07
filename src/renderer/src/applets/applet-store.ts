import {
  AsyncReadable,
  Writable,
  derived,
  lazyLoad,
  lazyLoadAndPoll,
  pipe,
  writable,
} from '@holochain-open-dev/stores';
import { encodeHashToBase64, EntryHash } from '@holochain/client';
import { BlockType, InternalAttachmentType } from '@lightningrodlabs/we-applet';

import { AppletHost } from './applet-host.js';
import { Applet } from './types.js';
import {
  appEntryIdFromDistInfo,
  clearAppletNotificationStatus,
  getAllIframes,
  loadAppletNotificationStatus,
} from '../utils.js';
import { ConductorInfo } from '../electron-api.js';
import { AppletBundlesStore } from '../applet-bundles/applet-bundles-store.js';

export class AppletStore {
  isAppletDev: boolean;

  constructor(
    public appletHash: EntryHash,
    public applet: Applet,
    public conductorInfo: ConductorInfo,
    public appletBundlesStore: AppletBundlesStore,
    isAppletDev: boolean,
  ) {
    this._unreadNotifications.set(loadAppletNotificationStatus(encodeHashToBase64(appletHash)));
    this.isAppletDev = isAppletDev;
  }

  host: AsyncReadable<AppletHost | undefined> = lazyLoad(async () => {
    const appletHashBase64 = encodeHashToBase64(this.appletHash);
    const allIframes = getAllIframes();
    const relevantIframe = allIframes.find((iframe) => iframe.id === appletHashBase64);
    if (relevantIframe) {
      return new AppletHost(relevantIframe, appletHashBase64);
    } else {
      return new Promise<AppletHost | undefined>((resolve) => {
        setTimeout(() => {
          const allIframes = getAllIframes();
          const relevantIframe = allIframes.find((iframe) => iframe.id === appletHashBase64);
          if (relevantIframe) {
            resolve(new AppletHost(relevantIframe, appletHashBase64));
          } else {
            console.warn(
              `Connecting to applet host for applet ${appletHashBase64} timed out in 10000ms`,
            );
          }
          resolve(undefined);
        }, 10000);
      });
    }
  });

  attachmentTypes: AsyncReadable<Record<string, InternalAttachmentType>> = pipe(
    this.host,
    (host) => {
      return lazyLoadAndPoll(async () => {
        if (!host) return Promise.resolve({});
        try {
          return new Promise(async (resolve) => {
            const timeout = setTimeout(() => {
              console.warn(
                `Getting attachmentTypes for applet ${host.appletId} timed out in 5000ms`,
              );
              resolve({});
            }, 5000);
            try {
              const attachmentTypes = await host.getAppletAttachmentTypes();
              clearTimeout(timeout);
              resolve(attachmentTypes);
            } catch (e: any) {
              if (e.toString().includes('before initialization')) {
                return;
              }
              console.warn('Failed to get attachment types: ', e);
            }
          });
        } catch (e) {
          console.warn(`Failed to get attachment types from applet "${host.appletId}": ${e}`);
          return Promise.resolve({});
        }
      }, 3000);
    },
  );

  blocks: AsyncReadable<Record<string, BlockType>> = pipe(this.host, (host) =>
    lazyLoadAndPoll(() => (host ? host.getBlocks() : Promise.resolve({})), 10000),
  );

  logo = this.appletBundlesStore.appletBundleLogo.get(
    appEntryIdFromDistInfo(this.applet.distribution_info),
  );

  _unreadNotifications: Writable<[string | undefined, number | undefined]> = writable([
    undefined,
    undefined,
  ]);

  unreadNotifications() {
    return derived(this._unreadNotifications, (store) => store);
  }

  setUnreadNotifications(unreadNotifications: [string | undefined, number | undefined]) {
    this._unreadNotifications.set(unreadNotifications);
  }

  clearNotificationStatus() {
    clearAppletNotificationStatus(encodeHashToBase64(this.appletHash));
    this._unreadNotifications.set([undefined, undefined]);
  }
}
