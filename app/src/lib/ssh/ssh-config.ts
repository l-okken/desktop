import * as Os from 'os'
import * as Path from 'path'
import { readdir, readFile } from 'fs/promises'

/** The settings of `~/.ssh/config` that apply to a single host. */
export interface ISSHHostConfig {
  /** The host to connect to, which is the given host if there's no HostName */
  readonly hostName: string
  /** The paths of the keys to use for this host. These are never read. */
  readonly identityFiles: ReadonlyArray<string>
}

interface ISSHConfigBlock {
  /** The patterns of the Host directive. Empty for blocks that never apply. */
  readonly patterns: ReadonlyArray<string>
  hostName?: string
  readonly identityFiles: Array<string>
}

/** Returns the contents of the files matching an Include pattern. */
export type SSHConfigIncludeReader = (
  pattern: string
) => Promise<ReadonlyArray<string>>

/** The maximum depth of nested Include directives, same as OpenSSH. */
const MaxIncludeDepth = 16

/** Split the arguments of a directive, taking quotes and comments into account. */
function splitArguments(value: string): ReadonlyArray<string> {
  const args = new Array<string>()
  const regex = /"([^"]*)"|(#.*)|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(value)) !== null) {
    if (match[2] !== undefined) {
      break
    }
    args.push(match[1] ?? match[3])
  }
  return args
}

/**
 * Parse the contents of an ssh config file into its blocks, in the order in
 * which OpenSSH evaluates them.
 *
 * Match blocks are parsed but never apply as we can't evaluate their criteria.
 */
export async function parseSSHConfig(
  text: string,
  readInclude: SSHConfigIncludeReader = async () => []
): Promise<ReadonlyArray<ISSHConfigBlock>> {
  // Everything before the first Host directive applies to all hosts.
  const globalBlock: ISSHConfigBlock = { patterns: ['*'], identityFiles: [] }
  const blocks = [globalBlock]

  const parse = async (
    contents: string,
    initialBlock: ISSHConfigBlock,
    depth: number
  ) => {
    let block = initialBlock

    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z]+)(?:\s*=\s*|\s+)(.*)$/.exec(line)
      if (match === null) {
        continue
      }

      const keyword = match[1].toLowerCase()
      const args = splitArguments(match[2])

      if (keyword === 'host' || keyword === 'match') {
        block = {
          patterns: keyword === 'host' ? args : [],
          identityFiles: [],
        }
        blocks.push(block)
      } else if (keyword === 'hostname' && args.length > 0) {
        // The first value that's obtained is the one that's used.
        block.hostName ??= args[0]
      } else if (keyword === 'identityfile' && args.length > 0) {
        block.identityFiles.push(args[0])
      } else if (keyword === 'include' && depth < MaxIncludeDepth) {
        for (const pattern of args) {
          for (const included of await readInclude(pattern)) {
            await parse(included, block, depth + 1)
          }
        }
      }
    }
  }

  await parse(text, globalBlock, 0)
  return blocks
}

function patternMatches(pattern: string, host: string) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${source}$`, 'i').test(host)
}

/** Whether a Host directive applies, where a negated pattern always wins. */
function blockApplies(block: ISSHConfigBlock, host: string) {
  const negated = block.patterns.filter(p => p.startsWith('!'))
  return (
    !negated.some(p => patternMatches(p.substring(1), host)) &&
    block.patterns.some(p => !p.startsWith('!') && patternMatches(p, host))
  )
}

/** Determine which settings apply to the given host. */
export function resolveSSHHost(
  blocks: ReadonlyArray<ISSHConfigBlock>,
  host: string
): ISSHHostConfig {
  const applicable = blocks.filter(b => blockApplies(b, host))
  const hostName = applicable.find(b => b.hostName !== undefined)?.hostName

  return {
    hostName:
      hostName === undefined
        ? host
        : hostName.replace(/%(%|h)/g, (_, token) =>
            token === 'h' ? host : '%'
          ),
    identityFiles: applicable.flatMap(b => b.identityFiles),
  }
}

/** Create a reader which resolves Include patterns the way OpenSSH does. */
function createIncludeReader(sshDirectory: string): SSHConfigIncludeReader {
  const homeDirectory = Path.dirname(sshDirectory)

  return async pattern => {
    const expanded = pattern.startsWith('~/')
      ? Path.join(homeDirectory, pattern.substring(2))
      : Path.resolve(sshDirectory, pattern)

    const directory = Path.dirname(expanded)
    const fileName = Path.basename(expanded)
    const names = /[*?]/.test(fileName)
      ? await readdir(directory).catch(() => [])
      : [fileName]

    const contents = await Promise.all(
      names
        .filter(name => patternMatches(fileName, name))
        .sort()
        .map(name =>
          readFile(Path.join(directory, name), 'utf8').catch(() => '')
        )
    )
    return contents
  }
}

let cachedBlocks: ReadonlyArray<ISSHConfigBlock> = []

/**
 * Read `~/.ssh/config` into the cache behind `getSSHHostConfig`.
 *
 * Resolving remotes is synchronous and widely used so we can't read the file
 * at that point. This should be called on launch and whenever the app regains
 * focus, as users edit this file by hand.
 */
export async function loadSSHConfig(
  sshDirectory: string = Path.join(Os.homedir(), '.ssh')
): Promise<void> {
  try {
    const text = await readFile(Path.join(sshDirectory, 'config'), 'utf8')
    cachedBlocks = await parseSSHConfig(text, createIncludeReader(sshDirectory))
  } catch {
    // Not having a config file is perfectly fine and the same as an empty one.
    cachedBlocks = []
  }
}

/** Get the settings for a host from the most recently loaded config file. */
export function getSSHHostConfig(host: string): ISSHHostConfig {
  return resolveSSHHost(cachedBlocks, host)
}

/**
 * Get the host which a remote really connects to.
 *
 * A `git@github-work:owner/repo.git` remote connects to whatever `github-work`
 * is configured to be in `~/.ssh/config`. Other protocols don't use that file.
 */
export function resolveRemoteHostname(remote: {
  readonly protocol: string
  readonly hostname: string
}): string {
  return remote.protocol === 'ssh'
    ? getSSHHostConfig(remote.hostname).hostName
    : remote.hostname
}

/** Get the alias which a remote connects through, if any. */
export function getRemoteSSHAlias(remote: {
  readonly protocol: string
  readonly hostname: string
}): string | null {
  return resolveRemoteHostname(remote).toLowerCase() !==
    remote.hostname.toLowerCase()
    ? remote.hostname
    : null
}
