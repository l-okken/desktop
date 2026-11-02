import * as URL from 'url'
import * as Path from 'path'

import { Account } from '../models/account'
import { IRemote } from '../models/remote'
import { getHTMLURL } from './api'
import { parseRemote, parseRepositoryIdentifier } from './remote-parsing'
import { caseInsensitiveEquals } from './compare'
import { GitHubRepository } from '../models/github-repository'
import { getAccountForRepositoryReference } from './repository-accounts'
import { resolveRemoteHostname } from './ssh/ssh-config'

export interface IMatchedGitHubRepository {
  /**
   * The name of the repository, e.g., for https://github.com/user/repo, the
   * name is `repo`.
   */
  readonly name: string

  /**
   * The login of the owner of the repository, e.g., for
   * https://github.com/user/repo, the owner is `user`.
   */
  readonly owner: string

  /** The account matching the repository remote */
  readonly account: Account
}

/**
 * Try to use the list of users and a remote URL to guess a GitHub repository.
 *
 * @param login The login of the account which the remote is known to belong to.
 *              There's no match if that account isn't signed in, as using
 *              another account's token would be wrong.
 */
export function matchGitHubRepository(
  accounts: ReadonlyArray<Account>,
  remote: string,
  login?: string | null
): IMatchedGitHubRepository | null {
  const parsedRemote = parseRemote(remote)
  if (parsedRemote === null) {
    return null
  }

  const remoteHostname = resolveRemoteHostname(parsedRemote).toLowerCase()
  const candidates = accounts.filter(account => {
    const { hostname } = URL.parse(getHTMLURL(account.endpoint))
    return hostname?.toLowerCase() === remoteHostname
  })

  const first = candidates.at(0)
  if (first === undefined) {
    return null
  }

  const { owner, name } = parsedRemote
  const account =
    login !== undefined && login !== null
      ? candidates.find(a => caseInsensitiveEquals(a.login, login))
      : getAccountForRepositoryReference(candidates, {
          endpoint: first.endpoint,
          owner: { login: owner },
          name,
        }) ?? first

  return account !== undefined ? { name, owner, account } : null
}

/**
 * Find an existing repository associated with this path
 *
 * @param repos The list of repositories tracked in the app
 * @param path The path on disk which might be a repository
 */
export function matchExistingRepository<T extends { readonly path: string }>(
  repos: ReadonlyArray<T>,
  path: string
): T | undefined {
  // Windows is guaranteed to be case-insensitive so we can be a bit less strict
  const normalize = __WIN32__
    ? (p: string) => Path.normalize(p).toLowerCase()
    : (p: string) => Path.normalize(p)

  const needle = normalize(path)
  return repos.find(r => normalize(r.path) === needle)
}

/**
 * Check whether or not a GitHub repository matches a given remote.
 *
 * @param gitHubRepository the repository containing information from the GitHub API
 * @param remote the remote details found in the Git repository
 */
export function repositoryMatchesRemote(
  gitHubRepository: GitHubRepository,
  remote: IRemote
): boolean {
  return (
    urlMatchesRemote(gitHubRepository.htmlURL, remote) ||
    urlMatchesRemote(gitHubRepository.cloneURL, remote)
  )
}

/**
 * Check whether or not a GitHub repository URL matches a given remote, by
 * parsing and comparing the structure of the each URL.
 *
 * @param url a URL associated with the GitHub repository
 * @param remote the remote details found in the Git repository
 */
export function urlMatchesRemote(url: string | null, remote: IRemote): boolean {
  if (url == null) {
    return false
  }

  const cloneUrl = parseRemote(url)
  const remoteUrl = parseRemote(remote.url)

  if (remoteUrl == null || cloneUrl == null) {
    return false
  }

  if (
    !caseInsensitiveEquals(
      resolveRemoteHostname(remoteUrl),
      resolveRemoteHostname(cloneUrl)
    )
  ) {
    return false
  }

  if (remoteUrl.owner == null || cloneUrl.owner == null) {
    return false
  }

  if (remoteUrl.name == null || cloneUrl.name == null) {
    return false
  }

  return (
    caseInsensitiveEquals(remoteUrl.owner, cloneUrl.owner) &&
    caseInsensitiveEquals(remoteUrl.name, cloneUrl.name)
  )
}

/**
 * Match a URL-like string to the Clone URL of a GitHub Repository
 *
 * @param url A remote-like URL to verify against the existing information
 * @param gitHubRepository GitHub API details for a repository
 */
export function urlMatchesCloneURL(
  url: string,
  gitHubRepository: GitHubRepository
): boolean {
  if (gitHubRepository.cloneURL === null) {
    return false
  }

  return urlsMatch(gitHubRepository.cloneURL, url)
}

export function urlsMatch(url1: string, url2: string) {
  const firstIdentifier = parseRepositoryIdentifier(url1)
  const secondIdentifier = parseRepositoryIdentifier(url2)

  const hostnameFor = (url: string, hostname: string | null) => {
    const parsed = parseRemote(url)
    return parsed !== null ? resolveRemoteHostname(parsed) : hostname
  }

  return (
    firstIdentifier !== null &&
    secondIdentifier !== null &&
    hostnameFor(url1, firstIdentifier.hostname) ===
      hostnameFor(url2, secondIdentifier.hostname) &&
    firstIdentifier.owner === secondIdentifier.owner &&
    firstIdentifier.name === secondIdentifier.name
  )
}
