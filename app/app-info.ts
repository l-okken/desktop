import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getSHA } from './git-info'
import { getUpdatesURL, getChannel } from '../script/dist-info'
import { version, productName } from './package.json'

const channel = getChannel()

/**
 * Forkdesk has its own OAuth App. Its credentials live in the gitignored
 * `.forkdesk.env` at the repository root, see `.forkdesk.env.example`.
 */
function readForkdeskEnv(): Record<string, string> {
  const envPath = join(__dirname, '..', '.forkdesk.env')
  // eslint-disable-next-line no-sync
  if (!existsSync(envPath)) {
    return {}
  }

  const entries: Record<string, string> = {}
  // eslint-disable-next-line no-sync
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match !== null) {
      entries[match[1]] = match[2]
    }
  }
  return entries
}

const s = JSON.stringify

const optionalStringReplacement = (value: string | undefined) =>
  value === undefined || value.length === 0 ? 'undefined' : s(value)

export function getReplacements() {
  const isDevBuild = channel === 'development'
  const forkdeskEnv = readForkdeskEnv()
  const oauthClientId =
    process.env.DESKTOP_OAUTH_CLIENT_ID || forkdeskEnv.DESKTOP_OAUTH_CLIENT_ID
  const oauthClientSecret =
    process.env.DESKTOP_OAUTH_CLIENT_SECRET ||
    forkdeskEnv.DESKTOP_OAUTH_CLIENT_SECRET

  return {
    __OAUTH_CLIENT_ID__: s(oauthClientId || ''),
    __OAUTH_SECRET__: s(oauthClientSecret || ''),
    __DARWIN__: process.platform === 'darwin',
    __WIN32__: process.platform === 'win32',
    __LINUX__: process.platform === 'linux',
    __APP_NAME__: s(productName),
    __APP_VERSION__: s(version),
    __DEV__: isDevBuild,
    __DEV_SECRETS__: isDevBuild || !oauthClientSecret,
    __RELEASE_CHANNEL__: s(channel),
    __UPDATES_URL__: s(process.env.DESKTOP_E2E_UPDATES_URL ?? getUpdatesURL()),
    __ERROR_REPORTING_ENDPOINT__: optionalStringReplacement(
      process.env.DESKTOP_ERROR_REPORTING_ENDPOINT
    ),
    __NON_FATAL_ERROR_REPORTING_ENDPOINT__: optionalStringReplacement(
      process.env.DESKTOP_NON_FATAL_ERROR_REPORTING_ENDPOINT
    ),
    __SHA__: s(getSHA()),
    'process.platform': s(process.platform),
    'process.env.NODE_ENV': s(process.env.NODE_ENV || 'development'),
    'process.env.TEST_ENV': s(process.env.TEST_ENV),
  }
}
