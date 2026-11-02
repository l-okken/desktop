import memoizeOne from 'memoize-one'
import { getHTMLURL } from '../api'
import { getGenericPassword, getGenericUsername } from '../generic-git-auth'
import { AccountsStore } from '../stores'
import { urlWithoutCredentials } from './url-without-credentials'
import { Account } from '../../models/account'
import { getAccountForRepositoryReference } from '../repository-accounts'

/**
 * When we're asked for credentials we're typically first asked for the username
 * immediately followed by the password. We memoize the getGenericPassword call
 * such that we only call it once per endpoint/login pair. Since we include the
 * trampoline token in the invalidation key we'll only call it once per
 * trampoline session.
 */
const memoizedGetGenericPassword = memoizeOne(
  (_trampolineToken: string, endpoint: string, login: string) =>
    getGenericPassword(endpoint, login)
)

export async function findGitHubTrampolineAccount(
  accountsStore: AccountsStore,
  remoteUrl: string
): Promise<Account | undefined> {
  const accounts = await accountsStore.getAll()
  return findAccountForCredentialUrl(accounts, remoteUrl)
}

/**
 * Find the account for a credential request.
 *
 * Git includes the path of the repository when asking for GitHub.com
 * credentials, see `withTrampolineEnv`, so we can pick the account linked to it.
 */
export function findAccountForCredentialUrl(
  accounts: ReadonlyArray<Account>,
  remoteUrl: string
): Account | undefined {
  const parsedUrl = new URL(remoteUrl)
  const candidates = accounts.filter(
    a => new URL(getHTMLURL(a.endpoint)).origin === parsedUrl.origin
  )
  const first = candidates.at(0)
  const [owner, name] = parsedUrl.pathname.split('/').filter(x => x.length > 0)

  if (first === undefined || owner === undefined || name === undefined) {
    return first
  }

  return (
    getAccountForRepositoryReference(candidates, {
      endpoint: first.endpoint,
      owner: { login: owner },
      name: name.replace(/\.git$/, ''),
    }) ?? undefined
  )
}

export async function findGenericTrampolineAccount(
  trampolineToken: string,
  remoteUrl: string
) {
  const parsedUrl = new URL(remoteUrl)
  const endpoint = urlWithoutCredentials(remoteUrl)

  const login =
    parsedUrl.username === ''
      ? getGenericUsername(endpoint)
      : parsedUrl.username

  if (!login) {
    return undefined
  }

  const token = await memoizedGetGenericPassword(
    trampolineToken,
    endpoint,
    login
  )

  if (!token) {
    // We have a username but no password, that warrants a warning
    log.warn(`credential: generic password for ${remoteUrl} missing`)
    return undefined
  }

  return { login, endpoint, token }
}
