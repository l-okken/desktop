import * as Path from 'path'
import { IRepositoryGroup } from '../models/repository-group'
import { caseInsensitiveEquals } from './compare'
import { parseRepositoryIdentifier } from './remote-parsing'

/** Is the path the given folder, or inside of it? */
function isInFolder(path: string, folder: string) {
  const relative = Path.relative(folder, path)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !Path.isAbsolute(relative))
  )
}

/**
 * Find the group of a repository. The remote says most about a repository so
 * that's what goes first, followed by the folder that it's in.
 */
export function findRepositoryGroup(
  groups: ReadonlyArray<IRepositoryGroup>,
  path: string,
  sshHostAlias: string | undefined
): IRepositoryGroup | null {
  const byAlias =
    sshHostAlias !== undefined
      ? groups.find(g => caseInsensitiveEquals(g.sshHostAlias, sshHostAlias))
      : undefined

  return (
    byAlias ??
    groups.find(g => g.rootPath !== null && isInFolder(path, g.rootPath)) ??
    null
  )
}

/**
 * Get the URL to use for a repository in order to connect through an alias.
 *
 * Accepts URLs as well as the `owner/name` shortcut. Returns null for anything
 * that doesn't identify a repository.
 */
export function getRemoteUrlForAlias(
  url: string,
  sshHostAlias: string
): string | null {
  const identifier = parseRepositoryIdentifier(url.trim())
  return identifier !== null
    ? `git@${sshHostAlias}:${identifier.owner}/${identifier.name}.git`
    : null
}

/** Make up a name for a group from an alias: `github-work` becomes `work`. */
export const getGroupNameFromAlias = (sshHostAlias: string) =>
  sshHostAlias.replace(/^github(\.com)?-/i, '')
