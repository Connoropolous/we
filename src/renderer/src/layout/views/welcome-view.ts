import { html, LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiAccountLockOpen, mdiAccountMultiplePlus, mdiViewGridPlus } from '@mdi/js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';

enum WelcomePageView {
  Main,
}
@localized()
@customElement('welcome-view')
export class WelcomeView extends LitElement {
  @state()
  view: WelcomePageView = WelcomePageView.Main;

  resetView() {
    this.view = WelcomePageView.Main;
  }

  renderExplanationCard() {
    return html`
      <sl-card style="flex: 1">
        <span class="title" slot="header">${msg('What is We?')}</span>
        <div class="column" style="text-align: left; font-size: 1.15em;">
          <span>${msg('We is a group collaboration OS.')}</span>
          <br />
          <span
            >${msg(
              'In We, first you create a group, and then you install applets to that group.',
            )}</span
          >
          <br />
          <span>${msg('You can see all the groups you are part of in the left sidebar.')}</span>
          <br />
          <span
            >${msg(
              'You can also see all the applets that you have installed in the top sidebar, if you have any.',
            )}</span
          >
          <br />
          <span
            >${msg(
              'WARNING! We is in alpha version, which means that is not ready for production use yet. Expect bugs, breaking changes, and to lose all the data for all groups when you upgrade to a new version of We.',
            )}</span
          >
        </div>
      </sl-card>
    `;
  }

  renderManagingGroupsCard() {
    return html`
      <sl-card style="flex: 1; margin-left: 16px">
        <span class="title" slot="header">${msg('Managing Groups')}</span>
        <div style="text-align: left; font-size: 1.15em;">
          <ol style="line-height: 180%; margin: 0;">
            <li>
              ${msg('To create a new group, click on the "Add Group"')}
              <sl-icon
                style="position: relative; top: 0.25em;"
                .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
              ></sl-icon>
              ${msg('button in the left sidebar.')}
            </li>
            <li>
              ${msg(
                'After creating a group, create a profile for this group. Only the members of that group are going to be able to see your profile.',
              )}
            </li>
            <li>
              ${msg('Invite other members to the group by sharing the group link with them.')}
            </li>
            <li>${msg('Install applets that you want to use as a group.')}</li>
          </ol>
        </div>
      </sl-card>
    `;
  }

  render() {
    switch (this.view) {
      case WelcomePageView.Main:
        return html`
          <div class="column" style="align-items: center; flex: 1; overflow: auto; padding: 24px;">
            <div class="row" style="margin-top: 100px; flex-wrap: wrap;">
              <button
                class="btn"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('request-create-group', {
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(
                      new CustomEvent('request-create-group', {
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }
                }}
              >
                <div class="row center-content">
                  <sl-icon
                    .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
                    style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                  ></sl-icon>
                  <span>${msg('Create Group')}</span>
                </div>
              </button>
              <button
                class="btn"
                @click=${() => {
                  this.dispatchEvent(new CustomEvent('open-appstore'));
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(new CustomEvent('open-appstore'));
                  }
                }}
              >
                <div class="row center-content">
                  <sl-icon
                    .src=${wrapPathInSvg(mdiViewGridPlus)}
                    style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                  ></sl-icon>
                  <span>${msg('Applet Library')}</span>
                </div>
              </button>
              <button
                class="btn"
                @click=${(_e) =>
                  this.dispatchEvent(
                    new CustomEvent('request-join-group', {
                      composed: true,
                      bubbles: true,
                    }),
                  )}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') {
                    this.dispatchEvent(
                      new CustomEvent('request-join-group', {
                        composed: true,
                        bubbles: true,
                      }),
                    );
                  }
                }}
              >
                <div class="row center-content">
                  <sl-icon
                    .src=${wrapPathInSvg(mdiAccountLockOpen)}
                    style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                  ></sl-icon>
                  <span>${'Join Group'}</span>
                </div>
              </button>
            </div>

            <div class="row" style="margin-top: 100px; max-width: 1200px">
              ${this.renderExplanationCard()} ${this.renderManagingGroupsCard()}
            </div>
          </div>
        `;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 25px;
        height: 100px;
        min-width: 300px;
        background: var(--sl-color-primary-800);
        color: white;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 2px 5px var(--sl-color-primary-900);
      }

      .btn:hover {
        background: var(--sl-color-primary-700);
      }

      .btn:active {
        background: var(--sl-color-primary-600);
      }
    `,
    weStyles,
  ];
}
