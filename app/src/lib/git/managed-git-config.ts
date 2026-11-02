import * as Os from 'os'
import * as Path from 'path'
import { copyFile, readFile, rm, writeFile } from 'fs/promises'
import { IRepositoryGroup } from '../../models/repository-group'

const BlockStart = '# >>> Forkdesk managed'
const BlockEnd = '# <<< Forkdesk managed'
const IdentityFileHeader = '# Managed by Forkdesk, changes will be overwritten.'
const IdentityFilePrefix = '.gitconfig-forkdesk-'

/** Escape a value for use in a Git config file, between double quotes. */
const escapeValue = (value: string) =>
  value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

const toSlashes = (path: string) => path.replace(/\\/g, '/')

/** Split a Git config file in what's inside and outside of our block. */
function splitManagedBlock(contents: string) {
  const start = contents.indexOf(BlockStart)
  const end = contents.indexOf(BlockEnd)

  if (start === -1 || end === -1 || end < start) {
    return { before: contents, after: '' }
  }

  return {
    before: contents.substring(0, start),
    after: contents.substring(end + BlockEnd.length).replace(/^\r?\n/, ''),
  }
}

/**
 * Whether the user's own config already determines the identity for an alias.
 *
 * In that case we leave it to their configuration, which we never touch.
 */
export function hasOwnIncludeForAlias(gitConfig: string, alias: string) {
  const { before, after } = splitManagedBlock(gitConfig)
  const own = `${before}${after}`.toLowerCase()
  return (
    own.includes(`remote.*.url:git@${alias.toLowerCase()}:`) ||
    own.includes(`remote.*.url:ssh://git@${alias.toLowerCase()}/`)
  )
}

const hasIdentity = (group: IRepositoryGroup) =>
  group.userName.length > 0 || group.userEmail.length > 0

const getIdentityFileName = (group: IRepositoryGroup) =>
  `${IdentityFilePrefix}${group.id}`

/** Get the contents of the file with the identity of a group. */
export function getIdentityFileContents(group: IRepositoryGroup) {
  const lines = [IdentityFileHeader, '[user]']
  if (group.userName.length > 0) {
    lines.push(`\tname = "${escapeValue(group.userName)}"`)
  }
  if (group.userEmail.length > 0) {
    lines.push(`\temail = "${escapeValue(group.userEmail)}"`)
  }
  return `${lines.join('\n')}\n`
}

/** Get the lines of the managed block for the groups which need one. */
function getManagedLines(
  groups: ReadonlyArray<IRepositoryGroup>,
  homeDirectory: string
) {
  const lines = new Array<string>()

  for (const group of groups) {
    const path = escapeValue(
      toSlashes(Path.join(homeDirectory, getIdentityFileName(group)))
    )
    const alias = escapeValue(group.sshHostAlias)
    const conditions = [
      `hasconfig:remote.*.url:git@${alias}:*/**`,
      `hasconfig:remote.*.url:ssh://git@${alias}/**`,
    ]

    if (group.rootPath !== null) {
      const folder = toSlashes(group.rootPath).replace(/\/+$/, '')
      // The trailing slash makes this match everything below the folder.
      conditions.push(
        `${__WIN32__ ? 'gitdir/i' : 'gitdir'}:${escapeValue(folder)}/`
      )
    }

    for (const condition of conditions) {
      lines.push(`[includeIf "${condition}"]`, `\tpath = "${path}"`)
    }
  }

  return lines
}

/**
 * Replace our block in the contents of a Git config file, leaving everything
 * around it exactly as it was. Without any lines the block is removed.
 */
export function updateManagedBlock(
  contents: string,
  managedLines: ReadonlyArray<string>
) {
  const eol = contents.includes('\r\n') ? '\r\n' : '\n'
  const { before, after } = splitManagedBlock(contents)

  if (managedLines.length === 0) {
    return `${before}${after}`
  }

  const separator = before.length > 0 && !before.endsWith('\n') ? eol : ''
  const block = [BlockStart, ...managedLines, BlockEnd].join(eol)

  return `${before}${separator}${block}${eol}${after}`
}

const readIfExists = (path: string) =>
  readFile(path, 'utf8').catch(e => {
    if (e.code === 'ENOENT') {
      return null
    }
    throw e
  })

/**
 * Make the Git config reflect the groups: each one with an identity gets a file
 * with that identity, which our block in the global config file includes.
 *
 * Doesn't write anything if nothing changes, and creates a backup of the global
 * config file before changing it. Files of removed groups are deleted, but only
 * if they're recognized as being ours.
 *
 * @param removed Groups which no longer exist.
 */
export async function syncManagedGitConfig(
  groups: ReadonlyArray<IRepositoryGroup>,
  removed: ReadonlyArray<IRepositoryGroup> = [],
  homeDirectory: string = Os.homedir(),
  now = Date.now
): Promise<void> {
  const configPath = Path.join(homeDirectory, '.gitconfig')
  const existing = await readIfExists(configPath)
  const current = existing ?? ''

  const applicable = groups.filter(
    g => hasIdentity(g) && !hasOwnIncludeForAlias(current, g.sshHostAlias)
  )

  for (const group of applicable) {
    await writeFile(
      Path.join(homeDirectory, getIdentityFileName(group)),
      getIdentityFileContents(group)
    )
  }

  const updated = updateManagedBlock(
    current,
    getManagedLines(applicable, homeDirectory)
  )

  if (updated !== current) {
    if (existing !== null) {
      await copyFile(configPath, `${configPath}.bak-${now()}`)
    }
    await writeFile(configPath, updated)
  }

  const applicableIds = new Set(applicable.map(g => g.id))
  for (const group of [...removed, ...groups]) {
    if (!applicableIds.has(group.id)) {
      const path = Path.join(homeDirectory, getIdentityFileName(group))
      const contents = await readIfExists(path)
      if (contents?.startsWith(IdentityFileHeader)) {
        await rm(path)
      }
    }
  }
}
