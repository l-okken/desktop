import { execFile } from 'child_process'
import * as Os from 'os'
import * as Path from 'path'
import { access, appendFile, copyFile, mkdir, readFile } from 'fs/promises'
import { parseSSHConfig } from './ssh-config'

const WindowsSSHKeygenPath = 'C:/Windows/System32/OpenSSH/ssh-keygen.exe'

const pathExists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  )

const run = (file: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, [...args], { windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
  )

/** Is this usable in a file name and as the host of an SSH remote? */
export const isValidSSHIdentifier = (value: string) =>
  /^[a-z0-9][a-z0-9._-]*$/i.test(value)

/** The default alias for a key, following the convention of the user's setup. */
export const getDefaultSSHAlias = (identifier: string) => `github-${identifier}`

/** Get the path of the private key for an identifier. This file is never read. */
export const getSSHKeyPath = (
  identifier: string,
  homeDirectory: string = Os.homedir()
) => Path.join(homeDirectory, '.ssh', `id_ed25519_${identifier}`)

export interface ISSHKeyResult {
  /** The contents of the public key, which is safe to show and to share. */
  readonly publicKey: string
  /** False if there already was a key, which is never overwritten. */
  readonly created: boolean
}

async function runSSHKeygen(args: ReadonlyArray<string>) {
  const binary =
    __WIN32__ && (await pathExists(WindowsSSHKeygenPath))
      ? WindowsSSHKeygenPath
      : 'ssh-keygen'
  await run(binary, args)
}

/** Create the key for an identifier without a passphrase, unless it exists. */
export async function createSSHKey(
  email: string,
  identifier: string,
  homeDirectory: string = Os.homedir(),
  keygen: (args: ReadonlyArray<string>) => Promise<void> = runSSHKeygen
): Promise<ISSHKeyResult> {
  if (!isValidSSHIdentifier(identifier)) {
    throw new Error(`"${identifier}" can't be used as an identifier for a key.`)
  }

  const keyPath = getSSHKeyPath(identifier, homeDirectory)
  const created = !(await pathExists(keyPath))

  if (created) {
    await mkdir(Path.dirname(keyPath), { recursive: true })
    const comment = email.replace(/[\r\n]/g, ' ')
    await keygen(['-t', 'ed25519', '-C', comment, '-f', keyPath, '-N', ''])
  }

  const publicKey = await readFile(`${keyPath}.pub`, 'utf8').catch(() => {
    throw new Error(
      `${keyPath} exists but ${keyPath}.pub doesn't, so the public key is unknown.`
    )
  })

  return { publicKey: publicKey.trim(), created }
}

/** Get the block for `~/.ssh/config`, the same as the user's existing ones. */
export function getSSHHostBlock(alias: string, identifier: string, eol = '\n') {
  return [
    `Host ${alias}`,
    '  HostName github.com',
    '  User git',
    `  IdentityFile ~/.ssh/id_ed25519_${identifier}`,
    '  IdentitiesOnly yes',
    '',
  ].join(eol)
}

/**
 * Append a block for the alias to `~/.ssh/config`, after making a backup.
 *
 * The existing contents are never rewritten. Does nothing if the alias already
 * exists, and returns whether it added the block.
 */
export async function addSSHHostBlock(
  alias: string,
  identifier: string,
  homeDirectory: string = Os.homedir(),
  now = Date.now
): Promise<boolean> {
  if (!isValidSSHIdentifier(alias) || !isValidSSHIdentifier(identifier)) {
    throw new Error(`"${alias}" can't be used as an SSH host alias.`)
  }

  const configPath = Path.join(homeDirectory, '.ssh', 'config')
  const existing = await readFile(configPath, 'utf8').catch(e => {
    if (e.code === 'ENOENT') {
      return null
    }
    throw e
  })

  if (existing !== null) {
    const blocks = await parseSSHConfig(existing)
    const lowerCaseAlias = alias.toLowerCase()
    if (
      blocks.some(b => b.patterns.some(p => p.toLowerCase() === lowerCaseAlias))
    ) {
      return false
    }
    await copyFile(configPath, `${configPath}.bak-${now()}`)
  } else {
    await mkdir(Path.dirname(configPath), { recursive: true })
  }

  const eol = existing?.includes('\r\n') ? '\r\n' : '\n'
  const contents = existing ?? ''
  const separator =
    contents.length === 0 ? '' : contents.endsWith('\n') ? eol : `${eol}${eol}`

  await appendFile(
    configPath,
    `${separator}${getSSHHostBlock(alias, identifier, eol)}`
  )
  return true
}

/**
 * Get the users which Windows OpenSSH wouldn't accept from the output of
 * `icacls`. The names of the system accounts depend on the Windows language.
 */
export function parseUnexpectedUsers(
  icaclsOutput: string,
  currentUser: string
): ReadonlyArray<string> {
  const users = new Array<string>()

  for (const line of icaclsOutput.split(/\r?\n/)) {
    const match = /(?:^|\s)([^\s:][^:]*\\[^:]+?):\(/.exec(line)
    if (match !== null) {
      const name = match[1].trim().substring(match[1].lastIndexOf('\\') + 1)
      const isExpected =
        name.toLowerCase() === currentUser.toLowerCase() ||
        /^(system|systeem|administrators|administratoren)$/i.test(name)

      if (!isExpected) {
        users.push(match[1].trim())
      }
    }
  }

  return users
}

/** Get the users who shouldn't have access to a file according to OpenSSH. */
export async function getUnexpectedUsersOfFile(
  path: string
): Promise<ReadonlyArray<string>> {
  if (!__WIN32__) {
    return []
  }

  try {
    return parseUnexpectedUsers(
      await run('icacls', [path]),
      Os.userInfo().username
    )
  } catch (e) {
    log.warn(`Unable to determine who has access to ${path}`, e)
    return []
  }
}
