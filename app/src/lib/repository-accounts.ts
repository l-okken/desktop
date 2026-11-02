import { Account } from '../models/account'
import { getObject, setObject } from './local-storage'
import { caseInsensitiveEquals } from './compare'

const LinkedAccountsKey = 'repository-account-logins'

/** The parts of a GitHub repository which identify it across its usages. */
export interface IRepositoryReference {
  readonly endpoint: string
  readonly owner: { readonly login: string }
  readonly name: string
}

const getLinks = () =>
  getObject<Record<string, string>>(LinkedAccountsKey) ?? {}

const getLinkKey = ({ endpoint, owner, name }: IRepositoryReference) =>
  `${endpoint}|${owner.login}/${name}`.toLowerCase()

/** Remember which account's token to use for a repository. */
export function linkRepositoryToAccount(
  repository: IRepositoryReference,
  login: string
) {
  const links = getLinks()
  const key = getLinkKey(repository)

  if (links[key] !== login) {
    setObject(LinkedAccountsKey, { ...links, [key]: login })
  }
}

/** Get the login of the account linked to a repository, if any. */
export function getLinkedAccountLogin(
  repository: IRepositoryReference
): string | undefined {
  return getLinks()[getLinkKey(repository)]
}

/**
 * Get the account to use for API requests about a repository.
 *
 * A repository which is linked to an account that isn't signed in has no
 * account at all as we must never send a request using someone else's token.
 * Without a link we prefer the account owning the repository and otherwise fall
 * back to the first one, which is the only one for most users.
 */
export function getAccountForRepositoryReference(
  accounts: ReadonlyArray<Account>,
  repository: IRepositoryReference
): Account | null {
  const candidates = accounts.filter(a => a.endpoint === repository.endpoint)
  const findByLogin = (login: string) =>
    candidates.find(a => caseInsensitiveEquals(a.login, login))

  const linked = getLinkedAccountLogin(repository)
  if (linked !== undefined) {
    return findByLogin(linked) ?? null
  }

  return findByLogin(repository.owner.login) ?? candidates.at(0) ?? null
}

/**
 * Get what to show the user about the account used for a repository.
 *
 * That's only of interest with several accounts to choose from, or when the
 * account that a repository needs isn't signed in.
 */
export function getAccountLabelForRepository(
  accounts: ReadonlyArray<Account>,
  repository: IRepositoryReference
): string | null {
  const account = getAccountForRepositoryReference(accounts, repository)
  if (account === null) {
    const linked = getLinkedAccountLogin(repository)
    return linked !== undefined ? `@${linked} (not signed in)` : null
  }

  const hasSeveralAccounts =
    accounts.filter(a => a.endpoint === repository.endpoint).length > 1

  return hasSeveralAccounts ? `@${account.login}` : null
}
