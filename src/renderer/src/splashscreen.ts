import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { weStyles } from './shared-styles';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiExitRun } from '@mdi/js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
// import { ipcRenderer } from 'electron';

enum SplashScreenMode {
  Loading,
  SetupLair,
  SetupLairConfirm,
  EnterPassword,
  Launching,
}

@customElement('splash-screen')
export class SplashScreen extends LitElement {
  @state()
  progressState: string = '';

  @state()
  passwordsDontMatch = false;

  @state()
  password: string | undefined;

  @state()
  launchError: string | undefined;

  @query('#password-input')
  passwordInput!: HTMLInputElement | undefined;

  @query('#confirm-password-input')
  confirmPasswordInput!: HTMLInputElement | undefined;

  @state()
  view: SplashScreenMode = SplashScreenMode.Loading;

  async firstUpdated() {
    (window as any).electronAPI.onProgressUpdate((e, payload) => {
      console.log('RECEIVED PROGRESS UPDATE: ', e, payload);
      this.progressState = payload;
    });
    const lairSetupRequired = await (window as any).electronAPI.lairSetupRequired();
    console.log('lairSetupRequired: ', lairSetupRequired);
    if (lairSetupRequired) {
      this.view = SplashScreenMode.SetupLair;
    } else {
      this.view = SplashScreenMode.EnterPassword;
    }
  }

  async setupAndLaunch() {
    const confirmPassword = this.confirmPasswordInput?.value;
    if (!confirmPassword || confirmPassword !== this.password) {
      this.passwordsDontMatch = true;
      return;
    }
    this.view = SplashScreenMode.Launching;
    try {
      await (window as any).electronAPI.launch(this.password);
    } catch (e) {
      console.error('Failed to launch: ', e);
      this.progressState = '';
      this.view = SplashScreenMode.SetupLair;
    }
  }

  async launch() {
    this.view = SplashScreenMode.Launching;
    try {
      await (window as any).electronAPI.launch(this.password);
    } catch (e: any) {
      console.error('Failed to launch: ', e);
      this.progressState = '';
      if (e.toString().includes('Wrong password.')) {
        this.password = undefined;
        this.launchError = 'Wrong password.';
        setTimeout(() => {
          if (this.passwordInput) this.passwordInput!.focus();
        });
        setTimeout(() => {
          this.launchError = undefined;
        }, 3000);
      } else {
        this.launchError = e;
        setTimeout(() => {
          this.launchError = undefined;
        }, 6000);
      }
      this.view = SplashScreenMode.EnterPassword;
    }
  }

  checkPasswords() {
    const confirmPassword = this.confirmPasswordInput?.value;
    if (!confirmPassword || confirmPassword !== this.password) {
      this.passwordsDontMatch = true;
    } else {
      this.passwordsDontMatch = false;
    }
  }

  setupDisabled() {
    return !this.password || this.password === '' || this.passwordsDontMatch;
  }

  renderSetupLair() {
    return html`
      <div class="column center-content">
        <h2>Setup We</h2>
        <div style="font-size: 17px; max-width: 500px; text-align: center;">
          Choose a password to encrypt your data and private keys. You will always need this
          password to start We.
        </div>
        <h3>Select Password:</h3>
        <input
          autofocus
          @input=${(_e: InputEvent) => {
            this.checkPasswords();
            this.password = this.passwordInput!.value;
          }}
          id="password-input"
          type="password"
        />
        <h3>Confirm Password:</h3>
        <input
          @input=${(_e: InputEvent) => this.checkPasswords()}
          id="confirm-password-input"
          type="password"
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              if (!this.setupDisabled()) {
                this.setupAndLaunch();
              }
            }
          }}
        />
        <div class="input-error ${this.passwordsDontMatch ? '' : 'color-transparent'}">
          Passwords don't match!
        </div>
        <button
          @click=${() => this.setupAndLaunch()}
          tabindex="0"
          style="margin-top: 10px; margin-bottom: 30px;"
          .disabled=${this.setupDisabled()}
        >
          Setup and Launch
        </button>
      </div>
    `;
  }

  renderEnterPassword() {
    return html`
      <div class="column center-content">
        <h3>Enter Password:</h3>
        <input
          autofocus
          @input=${(_e: InputEvent) => {
            this.password = this.passwordInput!.value;
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              this.launch();
            }
          }}
          id="password-input"
          type="password"
        />
        <button
          @click=${() => this.launch()}
          tabindex="0"
          style="margin-top: 30px; margin-bottom: 30px;"
          .disabled=${!this.password || this.password === ''}
        >
          Launch
        </button>
      </div>
    `;
  }

  renderContent() {
    switch (this.view) {
      case SplashScreenMode.Loading:
        return html`loading`;
      case SplashScreenMode.SetupLair:
        return this.renderSetupLair();
      case SplashScreenMode.EnterPassword:
        return this.renderEnterPassword();
      case SplashScreenMode.Launching:
        return this.renderLaunching();
      default:
        return html``;
    }
  }

  renderLaunching() {
    return html` <h1>Starting up...</h1> `;
  }

  renderExitButton() {
    return html`
      <div class="bottom-left row" style="align-items: center;">
        <sl-icon
          tabindex="0"
          @click=${() => (window as any).electronAPI.exit()}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              (window as any).electronAPI.exit();
            }
          }}
          title="Exit"
          class="exit-icon"
          .src=${wrapPathInSvg(mdiExitRun)}
        ></sl-icon>
      </div>
    `;
  }

  render() {
    return html`
      <div class="background">
        ${this.renderContent()} ${this.progressState === '' ? this.renderExitButton() : html``}
        <div class="bottom-left">${this.progressState}</div>
        <div class="bottom-right">Lightningrod Labs We</div>
        <div class="top-right errorbar row " style="${this.launchError ? '' : 'display: none;'}">
          ${this.launchError}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      weStyles,
      css`
        :host {
          flex: 1;
          display: flex;
          margin: 0;
          padding: 0;
          color: #e6e3fc;
        }

        h1 {
          color: #ffffff;
        }

        .errorbar {
          background: #990606;
          color: #e6e3fc;
          border-radius: 10px;
          font-weight: bold;
          align-items: center;
          justify-content: flex-end;
          padding: 18px;
          box-shadow: 0px 0px 3px 1px black;
          font-size: 17px;
        }

        .input-error {
          margin-top: 3px;
          color: red;
        }

        .color-transparent {
          color: transparent;
        }

        h3 {
          margin-bottom: 8px;
        }

        button {
          all: unset;
          cursor: pointer;
          background: #9b7429;
          color: #ffffff;
          padding: 10px;
          border-radius: 10px;
          font-weight: bold;
        }

        button:disabled {
          opacity: 0.7;
        }

        button:hover:not(:disabled) {
          background: #b7962b;
        }

        button:focus {
          outline: 2px solid orange;
        }

        input {
          height: 30px;
          width: 200px;
          font-size: 20px;
          border-radius: 8px;
        }

        .exit-icon {
          font-size: 24px;
          color: white;
          cursor: pointer;
        }

        .exit-icon:hover {
          color: #1cb717;
        }

        .loader {
          color: #e6e3fc;
          font-size: 35px;
        }

        .bottom-left {
          position: absolute;
          bottom: 5px;
          left: 5px;
          color: #ffffff;
          font-size: 15px;
        }

        .bottom-right {
          position: absolute;
          bottom: 5px;
          right: 10px;
          color: #ffffff;
          font-size: 15px;
        }

        .top-right {
          position: absolute;
          top: 5px;
          right: 10px;
          color: #ffffff;
        }

        .background {
          position: relative;
          display: flex;
          flex: 1;
          justify-content: center;
          align-items: center;
          height: 100vh;
          /* background-color: #331ead;
          background-size: cover;
          background-position: center center;
          background-image: url(moss_mushrooms.jpg); */
        }
      `,
    ];
  }
}
