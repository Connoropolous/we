import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { consume } from '@lit/context';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tag/tag.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import { weClientContext } from '../context';
import { HrlWithContext } from '@lightningrodlabs/we-applet';
import { WeClient, WeServices } from '@lightningrodlabs/we-applet';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiMagnetOn } from '@mdi/js';

@localized()
@customElement('hrl-magnet')
export class HrlMagnet extends LitElement {
  @property()
  hrlWithContext!: HrlWithContext;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient | WeServices;

  async hrlToClipboard() {
    await this.weClient.hrlToClipboard(this.hrlWithContext);
  }

  render() {
    return html`
      <sl-tooltip content="Add to Magnet">
        <div
          class="row btn"
          tabindex="0"
          @click=${() => this.hrlToClipboard()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.hrlToClipboard();
            }
          }}
        >
          <sl-icon .src=${wrapPathInSvg(mdiMagnetOn)}></sl-icon>
        </div>
      </sl-tooltip>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      /* .container {
        --bg-color: var(--bg-color);
        --bg-color-hover: var(--bg-color-hover);
      } */
      .btn {
        align-items: center;
        justify-content: center;
        background: var(--bg-color, white);
        padding: 9px;
        border-radius: 50%;
        box-shadow: 1px 1px 3px #6b6b6b;
        cursor: pointer;
      }

      .btn:hover {
        background: var(--bg-color-hover, #e4e4e4);
      }
    `,
  ];
}
