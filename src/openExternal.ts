import { Browser } from '@capacitor/browser'

/**
 * Opens an external URL in the right place:
 * - Native app (Capacitor/Android): launches the system browser or the
 *   matching app via intent — e.g. wa.me links open straight in WhatsApp.
 * - Plain browser (PWA): falls back to opening a new tab.
 */
export async function openExternal(url: string): Promise<void> {
  await Browser.open({ url })
}
