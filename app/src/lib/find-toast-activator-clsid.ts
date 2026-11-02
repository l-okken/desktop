import * as path from 'path'
import * as os from 'os'
import { existsSync } from 'fs'
import { shell } from 'electron'

/**
 * Checks all Windows shortcuts created by Squirrel looking for the toast
 * activator CLSID needed to handle Windows notifications from the Action Center.
 */
export function findToastActivatorClsid() {
  const shortcutPaths = [
    path.join(
      os.homedir(),
      'AppData',
      'Roaming',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Lennart Okken',
      'Forkdesk.lnk'
    ),
    path.join(os.homedir(), 'Desktop', 'Forkdesk.lnk'),
  ]

  for (const shortcutPath of shortcutPaths) {
    const toastActivatorClsid = findToastActivatorClsidInShorcut(shortcutPath)

    if (toastActivatorClsid !== undefined) {
      return toastActivatorClsid
    }
  }

  return undefined
}

function findToastActivatorClsidInShorcut(shortcutPath: string) {
  // Development builds aren't installed, and users can remove their shortcuts.
  // eslint-disable-next-line no-sync
  if (!existsSync(shortcutPath)) {
    return undefined
  }

  try {
    const shortcutDetails = shell.readShortcutLink(shortcutPath)

    if (
      shortcutDetails.toastActivatorClsid === undefined ||
      shortcutDetails.toastActivatorClsid === ''
    ) {
      return undefined
    }

    return shortcutDetails.toastActivatorClsid
  } catch (error) {
    log.error(
      `Error looking for toast activator CLSID in shortcut ${shortcutPath}`,
      error
    )
    return undefined
  }
}
