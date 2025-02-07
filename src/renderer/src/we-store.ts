import {
  asyncDerived,
  asyncDeriveStore,
  AsyncReadable,
  completed,
  lazyLoad,
  mapAndJoin,
  pipe,
  toPromise,
  Readable,
  Writable,
  writable,
  derived,
  manualReloadStore,
  asyncReadable,
} from '@holochain-open-dev/stores';
import {
  DnaHashMap,
  HoloHashMap,
  LazyHoloHashMap,
  LazyMap,
  pickBy,
  slice,
} from '@holochain-open-dev/utils';
import { AppInfo, AppWebsocket, ProvisionedCell } from '@holochain/client';
import { encodeHashToBase64 } from '@holochain/client';
import { EntryHashB64 } from '@holochain/client';
import { ActionHash, AdminWebsocket, CellType, DnaHash, EntryHash } from '@holochain/client';
import {
  GroupProfile,
  HrlWithContext,
  InternalAttachmentType,
  ProfilesLocation,
} from '@lightningrodlabs/we-applet';
import { v4 as uuidv4 } from 'uuid';
import { notify } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';

import { AppletBundlesStore } from './applet-bundles/applet-bundles-store.js';
import { GroupStore } from './groups/group-store.js';
import { DnaLocation, locateHrl } from './processes/hrl/locate-hrl.js';
import { ConductorInfo, getAllAppAssetsInfos, joinGroup } from './electron-api.js';
import {
  appEntryActionHashFromDistInfo,
  appEntryIdFromDistInfo,
  appIdFromAppletHash,
  appletHashFromAppId,
  appletIdFromAppId,
  deStringifyHrlWithContext,
  findAppForDnaHash,
  initAppClient,
  isAppRunning,
} from './utils.js';
import { AppletStore } from './applets/applet-store.js';
import { AppHashes, AppletHash, AppletId, DistributionInfo } from './types.js';
import { Applet } from './applets/types.js';
import { GroupClient } from './groups/group-client.js';
import { WebHappSource } from './processes/appstore/appstore-light.js';
import { AppEntry, Entity } from './processes/appstore/types.js';
import { fromUint8Array } from 'js-base64';
import { encode } from '@msgpack/msgpack';
import { AttachableViewerState, DashboardState } from './elements/main-dashboard.js';

export class WeStore {
  constructor(
    public adminWebsocket: AdminWebsocket,
    public appWebsocket: AppWebsocket,
    public conductorInfo: ConductorInfo,
    public appletBundlesStore: AppletBundlesStore,
    public isAppletDev: boolean,
  ) {}

  private _updatableApplets: Writable<Record<AppletId, Entity<AppEntry>>> = writable({});
  private _updatesAvailableByGroup: Writable<DnaHashMap<boolean>> = writable(new DnaHashMap());
  // The dashboardstate must be accessible by the AppletHost, which is why it needs to be tracked
  // here at the WeStore level
  private _dashboardState: Writable<DashboardState> = writable({
    viewType: 'personal',
  });

  private _attachableViewerState: Writable<AttachableViewerState> = writable({
    position: 'side',
    visible: false,
  });

  async groupStore(groupDnaHash: DnaHash): Promise<GroupStore | undefined> {
    const groupStores = await toPromise(this.groupStores);
    return groupStores.get(groupDnaHash);
  }

  async checkForUiUpdates() {
    // 1. Get all AppAssetsInfos
    const updatableApplets: Record<AppletId, Entity<AppEntry>> = {}; // AppEntry with the new assets by AppletId
    const appAssetsInfos = await getAllAppAssetsInfos();
    // console.log('@checkForUiUpdates:  appAssetsInfos: ', appAssetsInfos);
    const allAppEntries = await toPromise(this.appletBundlesStore.installableAppletBundles);
    // console.log('@checkForUiUpdates:  allAppEntries: ', allAppEntries);

    Object.entries(appAssetsInfos).forEach(([appId, appAssetInfo]) => {
      if (
        appAssetInfo.distributionInfo.type === 'appstore-light' &&
        appAssetInfo.type === 'webhapp' &&
        appAssetInfo.sha256
      ) {
        // TODO potentially fetch current AppEntry here and check last_updated field and compare
        const currentAppEntryId = appAssetInfo.distributionInfo.info.appEntryId;
        const maybeRelevantAppEntry = allAppEntries.find(
          (appEntryEntity) => encodeHashToBase64(appEntryEntity.id) === currentAppEntryId,
        );
        if (maybeRelevantAppEntry) {
          const appHashes: AppHashes = JSON.parse(maybeRelevantAppEntry.content.hashes);
          // Check that happ hash is the same but webhapp hash is different
          if (appHashes.type === 'webhapp') {
            if (
              appHashes.happ.sha256 === appAssetInfo.happ.sha256 &&
              appHashes.sha256 !== appAssetInfo.sha256
            ) {
              const appletId = appletIdFromAppId(appId);
              updatableApplets[appletId] = maybeRelevantAppEntry;
            }
          }
        }
      }
    });

    // console.log('@checkForUiUpdates:  updatableApplets: ', updatableApplets);
    this._updatableApplets.set(updatableApplets);

    const updatesAvailableByGroup = new DnaHashMap<boolean>();
    const groupStores = await toPromise(this.groupStores);
    await Promise.all(
      Array.from(groupStores.entries()).map(async ([dnaHash, groupStore]) => {
        const runningGroupApplets = await toPromise(groupStore.allMyRunningApplets);
        const runningGroupAppletsB64 = runningGroupApplets.map((hash) => encodeHashToBase64(hash));
        let updateAvailable = false;
        Object.keys(updatableApplets).forEach((appletId) => {
          if (runningGroupAppletsB64.includes(appletId)) {
            updateAvailable = true;
          }
        });
        updatesAvailableByGroup.set(dnaHash, updateAvailable);
      }),
    );
    this._updatesAvailableByGroup.set(updatesAvailableByGroup);
  }

  updatableApplets(): Readable<Record<AppletId, Entity<AppEntry>>> {
    return derived(this._updatableApplets, (store) => store);
  }

  updatesAvailableForGroup(groupDnaHash: DnaHash): Readable<boolean> {
    return derived(this._updatesAvailableByGroup, (store) => store.get(groupDnaHash));
  }

  appletUpdatable(appletHash: AppletHash): Readable<boolean> {
    return derived(this._updatableApplets, (store) =>
      Object.keys(store).includes(encodeHashToBase64(appletHash)),
    );
  }

  dashboardState(): Readable<DashboardState> {
    return derived(this._dashboardState, (state) => state);
  }

  setDashboardState(dashboardState: DashboardState) {
    this._dashboardState.set(dashboardState);
  }

  attachableViewerState(): Readable<AttachableViewerState> {
    return derived(this._attachableViewerState, (state) => state);
  }

  setAttachableViewerState(state: AttachableViewerState) {
    this._attachableViewerState.set(state);
  }

  /**
   * Clones the group DNA with a new unique network seed, and creates a group info entry in that DNA
   */
  public async createGroup(name: string, logo: string): Promise<AppInfo> {
    if (!logo) throw new Error('No logo provided.');

    // generate random network seed (maybe use random words instead later, e.g. https://www.npmjs.com/package/generate-passphrase)
    const networkSeed = uuidv4();

    const appInfo = await this.joinGroup(networkSeed); // this line also updates the matrix store

    const groupDnaHash: DnaHash = appInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0];

    const groupStore = await this.groupStore(groupDnaHash);

    try {
      if (!groupStore) throw new Error('GroupStore still undefined after joining group.');

      const groupProfile: GroupProfile = {
        logo_src: logo,
        name,
      };
      await groupStore.groupClient.setGroupProfile(groupProfile);
    } catch (e) {
      try {
        await this.leaveGroup(groupDnaHash);
        console.error(`Failed to set up group profile - left group again: ${e}`);
      } catch (err) {
        throw new Error(`Failed to leave group after failed profile creation: ${err}`);
      }
    }

    await this.reloadManualStores();
    return appInfo;
  }

  public async joinGroup(networkSeed: string): Promise<AppInfo> {
    try {
      const appInfo = await joinGroup(networkSeed);
      await this.reloadManualStores();
      return appInfo;
    } catch (e) {
      console.error('Error installing group app: ', e);
      return Promise.reject(new Error(`Failed to install group app: ${e}`));
    }
  }

  /**
   * Uninstalls the group DNA and all Applet DNA's that have been installed
   * only in this group
   *
   * @param groupDnaHash
   */
  public async leaveGroup(groupDnaHash: DnaHash) {
    // To cover the case where a Group app may be disable, we do the following:
    // 1. enable the Group DNA to make sure it's running
    // 2. load the GroupStores to make sure the GroupStore for that Group is available
    const allApps = await this.adminWebsocket.listApps({});
    const groupApps = allApps.filter((app) => app.installed_app_id.startsWith('group#'));

    const appToLeave = groupApps.find(
      (app) =>
        app.cell_info['group'][0][CellType.Provisioned].cell_id[0].toString() ===
        groupDnaHash.toString(),
    );

    if (!appToLeave) throw new Error('Group with this DNA hash not found in the conductor.');

    await this.adminWebsocket.enableApp({
      installed_app_id: appToLeave.installed_app_id,
    });
    await this.reloadManualStores();

    const groupStore = await this.groupStore(groupDnaHash);

    if (!groupStore)
      throw new Error(
        'GroupStore not found even after enabling Group app and reloading GroupStores.',
      );

    // We get all Applets here already before we uninstall anything, in case it fails.
    const applets = await groupStore.groupClient.getMyApplets();

    await this.adminWebsocket.uninstallApp({
      installed_app_id: appToLeave.installed_app_id,
    });

    await Promise.all(
      applets.map(async (appletHash) => {
        // TODO: Is this save? groupsForApplet depends on the network so it may not always
        // actually return all groups that depend on this applet
        const groupsForApplet = await this.getGroupsForApplet(appletHash);

        // console.warn(`@leaveGroup: found groups for applet ${encodeHashToBase64(appletHash)}: ${groupsForApplet.map(hash => encodeHashToBase64(hash))}`);

        if (groupsForApplet.length === 0) {
          // console.warn("@leaveGroup: Uninstalling applet with app id: ", encodeHashToBase64(appletHash));
          await this.adminWebsocket.uninstallApp({
            installed_app_id: appIdFromAppletHash(appletHash),
          });
          const backgroundIframe = document.getElementById(encodeHashToBase64(appletHash)) as
            | HTMLIFrameElement
            | undefined;
          if (backgroundIframe) {
            backgroundIframe.remove();
          }
        }
      }),
    );

    await this.reloadManualStores();
  }

  groupStores = manualReloadStore(async () => {
    const groupStores = new DnaHashMap<GroupStore>();
    const apps = await this.adminWebsocket.listApps({});
    const runningGroupsApps = apps
      .filter((app) => app.installed_app_id.startsWith('group#'))
      .filter((app) => isAppRunning(app));

    await Promise.all(
      runningGroupsApps.map(async (app) => {
        const groupDnaHash = app.cell_info['group'][0][CellType.Provisioned].cell_id[0];

        const groupAppAgentWebsocket = await initAppClient(app.installed_app_id);

        groupStores.set(groupDnaHash, new GroupStore(groupAppAgentWebsocket, groupDnaHash, this));
      }),
    );

    return groupStores;
  });

  installedApps = manualReloadStore(async () => this.adminWebsocket.listApps({}));

  runningApps = asyncDerived(this.installedApps, (apps) => apps.filter((app) => isAppRunning(app)));

  installedApplets = asyncDerived(this.installedApps, async (apps) =>
    apps
      .filter((app) => app.installed_app_id.startsWith('applet#'))
      .map((app) => appletHashFromAppId(app.installed_app_id)),
  );

  runningApplets = asyncDerived(this.runningApps, async (apps) =>
    apps
      .filter((app) => app.installed_app_id.startsWith('applet#'))
      .map((app) => appletHashFromAppId(app.installed_app_id)),
  );

  runningGroupsApps = asyncDerived(this.runningApps, (apps) =>
    apps.filter((app) => app.installed_app_id.startsWith('group#')),
  );

  groupsDnaHashes = asyncDerived(this.runningGroupsApps, (apps) => {
    const groupApps = apps.filter((app) => app.installed_app_id.startsWith('group#'));

    const groupsDnaHashes = groupApps.map((app) => {
      const cell = app.cell_info['group'][0][CellType.Provisioned] as ProvisionedCell;
      return cell.cell_id[0];
    });
    return groupsDnaHashes;
  });

  appletStores = new LazyHoloHashMap((appletHash: EntryHash) =>
    asyncReadable<AppletStore>(async (set) => {
      // console.log("@appletStores: attempting to get AppletStore for applet with hash: ", encodeHashToBase64(appletHash));
      const groups = await toPromise(this.groupsForApplet.get(appletHash));
      // console.log(
      //   '@appletStores: groups: ',
      //   Array.from(groups.keys()).map((hash) => encodeHashToBase64(hash)),
      // );

      if (groups.size === 0) throw new Error('Applet is not installed in any of the groups');

      const applet = await Promise.race(
        Array.from(groups.values()).map((groupStore) =>
          toPromise(groupStore.applets.get(appletHash)),
        ),
      );

      if (!applet) throw new Error('Applet not found yet');

      set(
        new AppletStore(
          appletHash,
          applet,
          this.conductorInfo,
          this.appletBundlesStore,
          this.isAppletDev,
        ),
      );
    }),
  );

  allRunningApplets = pipe(this.runningApplets, async (appletsHashes) => {
    // sliceAndJoin won't work here in case appletStores.get() returns an error
    // because an applet is installed in the conductor but not part of any of the groups
    const runningAppletStores = new HoloHashMap<AppletHash, AppletStore>();
    for (const hash of appletsHashes) {
      try {
        const appletStore = await toPromise(this.appletStores.get(hash));
        runningAppletStores.set(hash, appletStore);
      } catch (e) {
        console.warn(
          `Failed to get AppletStore for applet with hash ${encodeHashToBase64(hash)}: ${e}`,
        );
      }
    }
    return runningAppletStores;
  });

  allGroupsProfiles = asyncDeriveStore(this.groupStores, (stores) =>
    mapAndJoin(stores, (store) => store.groupProfile),
  );

  /**
   * A reliable function to get the groups for an applet and is guaranteed
   * to reflect the current state.
   */
  getGroupsForApplet = async (appletHash: AppletHash) => {
    const allApps = await this.adminWebsocket.listApps({});
    const groupApps = allApps.filter((app) => app.installed_app_id.startsWith('group#'));
    const groupsWithApplet: Array<DnaHash> = [];
    await Promise.all(
      groupApps.map(async (app) => {
        const groupAppAgentWebsocket = await initAppClient(app.installed_app_id);
        const groupDnaHash: DnaHash = app.cell_info['group'][0][CellType.Provisioned].cell_id[0];
        const groupClient = new GroupClient(groupAppAgentWebsocket, 'group');
        const allMyAppletDatas = await groupClient.getMyApplets();
        if (allMyAppletDatas.map((hash) => hash.toString()).includes(appletHash.toString())) {
          groupsWithApplet.push(groupDnaHash);
        }
      }),
    );
    return groupsWithApplet;
  };

  groupsForApplet = new LazyHoloHashMap((appletHash: EntryHash) =>
    pipe(
      this.groupStores,
      (allGroups) => mapAndJoin(allGroups, (store) => store.allMyApplets),
      async (appletsByGroup) => {
        // console.log(
        //   'appletsByGroup: ',
        //   Array.from(appletsByGroup.values()).map((hashes) =>
        //     hashes.map((hash) => encodeHashToBase64(hash)),
        //   ),
        // );
        const groupDnaHashes = Array.from(appletsByGroup.entries())
          .filter(([_groupDnaHash, appletsHashes]) =>
            appletsHashes.find((hash) => hash.toString() === appletHash.toString()),
          )
          .map(([groupDnaHash, _]) => groupDnaHash);

        // console.log('Requested applet hash: ', encodeHashToBase64(appletHash));
        // console.log('groupDnaHashes: ', groupDnaHashes);

        const groupStores = await toPromise(this.groupStores);

        // console.log(
        //   'GROUPSTORES HASHES: ',
        //   Array.from(groupStores.keys()).map((hash) => encodeHashToBase64(hash)),
        // );

        // console.log(
        //   'Sliced group stores: ',
        //   Array.from(slice(groupStores, groupDnaHashes).keys()).map((hash) =>
        //     encodeHashToBase64(hash),
        //   ),
        // );

        return slice(groupStores, groupDnaHashes);
      },
    ),
  );

  dnaLocations = new LazyHoloHashMap((dnaHash: DnaHash) =>
    asyncDerived(this.installedApps, async (installedApps) => {
      const app = findAppForDnaHash(installedApps, dnaHash);

      if (!app) throw new Error('The given dna is not installed');
      if (!app.appInfo.installed_app_id.startsWith('applet#'))
        throw new Error("The given dna is part of an app that's not an applet.");

      return {
        appletHash: appletHashFromAppId(app.appInfo.installed_app_id),
        appInfo: app.appInfo,
        roleName: app.roleName,
      } as DnaLocation;
    }),
  );

  hrlLocations = new LazyHoloHashMap(
    (dnaHash: DnaHash) =>
      new LazyHoloHashMap((hash: EntryHash | ActionHash) => {
        return asyncDerived(this.dnaLocations.get(dnaHash), async (dnaLocation: DnaLocation) => {
          const entryDefLocation = await locateHrl(this.adminWebsocket, dnaLocation, [
            dnaHash,
            hash,
          ]);
          if (!entryDefLocation) return undefined;

          return {
            dnaLocation,
            entryDefLocation,
          };
        });
      }),
  );

  attachableInfo = new LazyMap((hrlWithContextStringified: string) => {
    console.log('hrlWithContextStringified: ', hrlWithContextStringified);
    const hrlWithContext = deStringifyHrlWithContext(hrlWithContextStringified);
    return pipe(
      this.hrlLocations.get(hrlWithContext.hrl[0]).get(hrlWithContext.hrl[1]),
      (location) =>
        location
          ? pipe(
              this.appletStores.get(location.dnaLocation.appletHash),
              (appletStore) => appletStore!.host,
              (host) =>
                lazyLoad(() =>
                  host
                    ? host.getAppletAttachableInfo(
                        location.dnaLocation.roleName,
                        location.entryDefLocation.integrity_zome,
                        location.entryDefLocation.entry_def,
                        hrlWithContext,
                      )
                    : Promise.resolve(undefined),
                ),
            )
          : completed(undefined),
    );
  });

  appletsForBundleHash = new LazyHoloHashMap(
    (
      appletBundleHash: ActionHash, // action hash of the AppEntry in the app store
    ) =>
      pipe(
        this.allRunningApplets,
        (runningApplets) =>
          completed(
            pickBy(
              runningApplets,
              (appletStore) =>
                appEntryIdFromDistInfo(appletStore.applet.distribution_info).toString() ===
                appletBundleHash.toString(),
            ),
          ),
        (appletsForThisBundleHash) =>
          mapAndJoin(appletsForThisBundleHash, (_, appletHash) =>
            this.groupsForApplet.get(appletHash),
          ),
        (groupsByApplets) => {
          const appletsB64: Record<EntryHashB64, ProfilesLocation> = {};

          for (const [appletHash, groups] of Array.from(groupsByApplets.entries())) {
            if (groups.size > 0) {
              const firstGroupAppId = Array.from(groups.values())[0].groupClient.appAgentClient
                .installedAppId;
              appletsB64[encodeHashToBase64(appletHash)] = {
                profilesAppId: firstGroupAppId,
                profilesRoleName: 'group',
              };
            }
          }
          return completed(appletsB64);
        },
      ),
  );

  allAppletsHosts = pipe(this.allRunningApplets, (applets) =>
    mapAndJoin(applets, (appletStore) => appletStore.host),
  );

  allAttachmentTypes: AsyncReadable<Record<EntryHashB64, Record<string, InternalAttachmentType>>> =
    pipe(
      this.allRunningApplets,
      (runningApplets) => {
        return mapAndJoin(runningApplets, (appletStore) => appletStore.attachmentTypes);
      },
      (allAttachmentTypes) => {
        const attachments: Record<AppletId, Record<string, InternalAttachmentType>> = {};

        for (const [appletHash, appletAttachments] of Array.from(allAttachmentTypes.entries())) {
          if (Object.keys(appletAttachments).length > 0) {
            attachments[encodeHashToBase64(appletHash)] = appletAttachments;
          }
        }
        return completed(attachments);
      },
    );

  async installApplet(appletHash: EntryHash, applet: Applet): Promise<AppInfo> {
    console.log('Installing applet with hash: ', encodeHashToBase64(appletHash));
    const appId = appIdFromAppletHash(appletHash);
    if (!applet.network_seed) {
      throw new Error(
        'Network Seed not defined. Undefined network seed is currently not supported.',
      );
    }

    const appEntry = await this.appletBundlesStore.getAppEntry(
      appEntryActionHashFromDistInfo(applet.distribution_info),
    );

    console.log('@installApplet: got AppEntry: ', appEntry.entry);
    console.log('@installApplet: got Applet: ', applet);

    if (!appEntry) throw new Error('AppEntry not found in AppStore');

    const source: WebHappSource = JSON.parse(appEntry.entry.source);
    if (source.type !== 'https') throw new Error(`Unsupported applet source type '${source.type}'`);
    if (!(source.url.startsWith('https://') || source.url.startsWith('file://')))
      throw new Error(`Invalid applet source URL '${source.url}'`);

    const distributionInfo: DistributionInfo = JSON.parse(applet.distribution_info);

    const appInfo = await window.electronAPI.installAppletBundle(
      appId,
      applet.network_seed!,
      {},
      encodeHashToBase64(this.appletBundlesStore.appstoreClient.myPubKey),
      source.url,
      distributionInfo,
      applet.sha256_happ,
      applet.sha256_ui,
      applet.sha256_webhapp,
      appEntry.entry.metadata,
    );

    await this.reloadManualStores();
    return appInfo;
  }

  async uninstallApplet(appletHash: EntryHash): Promise<void> {
    // console.warn("@we-store: Uninstalling applet.");
    await this.adminWebsocket.uninstallApp({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    const iframe = document.getElementById(encodeHashToBase64(appletHash)) as
      | HTMLIFrameElement
      | undefined;
    if (iframe) {
      // console.warn("Got iframe with id. Removing it from DOM.");
      iframe.remove();
    }
    await this.reloadManualStores();
  }

  async disableApplet(appletHash: EntryHash) {
    const installed = await toPromise(this.isInstalled.get(appletHash));
    if (!installed) return;

    await this.adminWebsocket.disableApp({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    await this.reloadManualStores();
  }

  async enableApplet(appletHash: EntryHash) {
    const installed = await toPromise(this.isInstalled.get(appletHash));
    if (!installed) return;

    await this.adminWebsocket.enableApp({
      installed_app_id: appIdFromAppletHash(appletHash),
    });
    await this.reloadManualStores();
  }

  async reloadManualStores() {
    await this.groupStores.reload();
    await this.installedApps.reload();
    // The stuff below may not be necessary
    // const groupStores = await toPromise(this.groupStores);
    // await Promise.all(
    //   Array.from(groupStores.values()).map(async (store) => {
    //     await store.allMyApplets.reload();
    //     await store.allMyRunningApplets.reload();
    //   })
    // );
  }

  isInstalled = new LazyHoloHashMap((appletHash: EntryHash) => {
    this.installedApps.reload(); // required after fresh installation of app
    return asyncDerived(
      this.installedApplets,
      (appletsHashes) => !!appletsHashes.find((hash) => hash.toString() === appletHash.toString()),
    );
  });

  isRunning = new LazyHoloHashMap((appletHash: EntryHash) =>
    asyncDerived(
      this.runningApplets,
      (appletsHashes) => !!appletsHashes.find((hash) => hash.toString() === appletHash.toString()),
    ),
  );

  hrlToClipboard(hrlWithContext: HrlWithContext) {
    const clipboardJSON = window.localStorage.getItem('clipboard');
    let clipboardContent: Array<string> = [];
    const hrlWithContextStringified = fromUint8Array(encode(hrlWithContext));
    if (clipboardJSON) {
      clipboardContent = JSON.parse(clipboardJSON);
    }
    // Only add if it's not already there
    if (
      clipboardContent.filter(
        (hrlWithContextStringifiedStored) =>
          hrlWithContextStringifiedStored === hrlWithContextStringified,
      ).length === 0
    ) {
      clipboardContent.push(hrlWithContextStringified);
    }

    window.localStorage.setItem('clipboard', JSON.stringify(clipboardContent));
    notify(msg('Swooosh'));
    document.dispatchEvent(new CustomEvent('swooosh'));
  }

  removeHrlFromClipboard(hrlWithContext: HrlWithContext) {
    const clipboardJSON = window.localStorage.getItem('clipboard');
    let clipboardContent: Array<string> = [];
    const hrlWithContextStringified = fromUint8Array(encode(hrlWithContext));
    if (clipboardJSON) {
      clipboardContent = JSON.parse(clipboardJSON);
      const newClipboardContent = clipboardContent.filter(
        (hrlWithContextStringifiedStored) =>
          hrlWithContextStringifiedStored !== hrlWithContextStringified,
      );
      window.localStorage.setItem('clipboard', JSON.stringify(newClipboardContent));
      // const index = clipboardContent.indexOf(hrlB64);
      // console.log("INDEX: ", index);
      // if (index > -1) { // only splice array when item is found
      //   clipboardContent.splice(index, 1);
      // }
    }
  }
}
