/** Type declarations for the Chrome Side Panel API (not in webextension-polyfill). */

declare module "webextension-polyfill" {
  interface SidePanelOpenOptions {
    tabId?: number;
    windowId?: number;
  }

  interface SidePanelSetOptions {
    tabId?: number;
    path?: string;
    enabled?: boolean;
  }

  interface SidePanelApi {
    open(options: SidePanelOpenOptions): Promise<void>;
    setOptions(options: SidePanelSetOptions): Promise<void>;
  }

  namespace Browser {
    interface Browser {
      sidePanel: SidePanelApi;
    }
  }
}
