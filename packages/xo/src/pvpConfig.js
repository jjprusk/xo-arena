// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Injectable dependencies for the PvP store.
 * Call configurePvp() early in the app (e.g. main.jsx) before any PvP action is invoked.
 */
const _cfg = {
  connectSocket:    () => { throw new Error('@xo-arena/xo: configurePvp() not called') },
  disconnectSocket: () => {},
  getSocket:        () => { throw new Error('@xo-arena/xo: configurePvp() not called') },
  getToken:         async () => null,
  playSound:        () => {},
}

/**
 * @param {{
 *   connectSocket: (token?: string|null) => any,
 *   disconnectSocket: () => void,
 *   getSocket: () => any,
 *   getToken?: () => Promise<string|null>,
 *   playSound?: (key: string) => void,
 * }} options
 */
export function configurePvp(options) {
  Object.assign(_cfg, options)
}

export { _cfg as pvpCfg }
