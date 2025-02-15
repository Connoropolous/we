import { AsyncReadable, pipe, sliceAndJoin, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { encodeHashToBase64, EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../elements/applet-topbar-button.js';
import './create-group-dialog.js';

import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { weStyles } from '../shared-styles.js';
import { AppletStore } from '../applets/applet-store.js';
import { GroupStore } from '../groups/group-store.js';
import { groupStoreContext } from '../groups/context.js';
import { AppletHash, AppletId } from '@lightningrodlabs/we-applet';

// Sidebar for the applet instances of a group
@localized()
@customElement('group-applets-sidebar')
export class GroupAppletsSidebar extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @property()
  selectedAppletHash?: AppletHash;

  @property()
  indicatedAppletHashes: AppletId[] = [];

  // All the Applets that are running and part of this Group
  _groupApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.allMyRunningApplets, (myRunningApplets) =>
        sliceAndJoin(this.weStore.appletStores, myRunningApplets),
      ) as AsyncReadable<ReadonlyMap<EntryHash, AppletStore>>,
    () => [this._groupStore],
  );

  renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
    if (Array.from(applets.entries()).length === 0) {
      return html`
        <div
          class="row"
          style="align-items: center; font-size: 20px; padding-left: 10px; font-weight: 500;"
        >
          <span> No applets installed in this group... </span>
        </div>
      `;
    }

    return html`
      <div class="row" style="align-items: flex-end; padding-left: 10px;">
        ${Array.from(applets.entries())
          .sort((a1, a2) => a1[1].applet.custom_name.localeCompare(a2[1].applet.custom_name))
          .map(
            ([_appletBundleHash, appletStore]) => html`
              <applet-topbar-button
                .appletStore=${appletStore}
                .selected=${this.selectedAppletHash &&
                this.selectedAppletHash.toString() === appletStore.appletHash.toString()}
                .indicated=${this.indicatedAppletHashes.includes(
                  encodeHashToBase64(appletStore.appletHash),
                )}
                .tooltipText=${appletStore.applet.custom_name}
                placement="bottom"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('applet-selected', {
                      detail: {
                        groupDnaHash: this._groupStore.groupDnaHash,
                        appletHash: appletStore.appletHash,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                  appletStore.clearNotificationStatus();
                }}
              >
              </applet-topbar-button>
            `,
          )}
      </div>
    `;
  }

  renderAppletsLoading() {
    switch (this._groupApplets.value.status) {
      case 'pending':
        return html`<sl-skeleton
            style="height: 58px; width: 58px; --border-radius: 50%; border-radius: 50%; margin-right: 10px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; --border-radius: 50%; border-radius: 50%; margin-right: 10px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; --border-radius: 50%; border-radius: 50%; margin-right: 10px;"
            effect="pulse"
          ></sl-skeleton> `;
      case 'error':
        console.error('ERROR: ', this._groupApplets.value.error);
        return html`<display-error
          .headline=${msg('Error displaying the applets')}
          tooltip
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderApplets(this._groupApplets.value.value);
    }
  }

  render() {
    return html`
      <div class="row" style="flex: 1; align-items: center;">${this.renderAppletsLoading()}</div>
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
