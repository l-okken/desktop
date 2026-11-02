import { execFile } from 'child_process'
import * as Path from 'path'
import { resolveGitDir } from 'dugite'
import { getObject, setObject } from '../local-storage'
import { getSSHEnvironment } from './ssh'
import { getSSHHostConfig } from './ssh-config'

const CachedLoginsKey = 'ssh-alias-logins'

/** How long to wait before asking again about an alias which didn't work out. */
const FailureBackoff = 5 * 60 * 1000

interface ICachedLogin {
  readonly login: string
  /** The keys the login was determined with. A change invalidates the login. */
  readonly identityFiles: string
}

/** Runs `ssh -T` against an alias and returns everything that it printed. */
export type SSHGreetingReader = (alias: string) => Promise<string>

/**
 * Get the login out of the greeting printed by `ssh -T git@github.com`.
 *
 * That command always exits with code 1 so the output is all we have. Deploy
 * keys greet with `owner/repo`, which doesn't identify an account.
 */
export function parseSSHGreeting(output: string): string | null {
  const match = /^Hi ([^\s!/]+)! You've successfully authenticated/m.exec(
    output
  )
  return match?.[1] ?? null
}

function getSSHBinary(sshCommand: string | undefined) {
  if (sshCommand !== undefined) {
    return sshCommand.replace(/^"(.*)"$/, '$1')
  }

  return __WIN32__ ? Path.join(resolveGitDir(), 'usr', 'bin', 'ssh.exe') : 'ssh'
}

const readSSHGreeting: SSHGreetingReader = async alias => {
  const { GIT_SSH_COMMAND } = (await getSSHEnvironment()) as {
    GIT_SSH_COMMAND?: string
  }

  return new Promise(resolve => {
    const child = execFile(
      getSSHBinary(GIT_SSH_COMMAND),
      ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `git@${alias}`],
      { timeout: 20_000, windowsHide: true },
      (_, stdout, stderr) => resolve(`${stdout}\n${stderr}`)
    )
    child.stdin?.end()
  })
}

const pendingLookups = new Map<string, Promise<string | null>>()
const failedLookups = new Map<string, number>()

/** Allow checking an alias again right away, as its key was just added. */
export function forgetSSHAliasLookupFailure(alias: string) {
  failedLookups.delete(alias)
}

/** Forget everything that isn't persisted. Only meant for tests. */
export function resetSSHAliasLoginState() {
  pendingLookups.clear()
  failedLookups.clear()
}

/**
 * Find out which GitHub account the key of an SSH host alias belongs to.
 *
 * This connects to the host so the result is cached until the keys of the alias
 * change. Returns null if the login can't be determined, for example because
 * the user is offline or the alias doesn't lead to GitHub.
 */
export function getLoginForSSHAlias(
  alias: string,
  readGreeting: SSHGreetingReader = readSSHGreeting,
  now = Date.now
): Promise<string | null> {
  // Remotes come from repositories, so this can't be trusted to be a hostname.
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(alias)) {
    return Promise.resolve(null)
  }

  const identityFiles = getSSHHostConfig(alias).identityFiles.join('|')
  const cached = getObject<Record<string, ICachedLogin>>(CachedLoginsKey) ?? {}
  if (cached[alias]?.identityFiles === identityFiles) {
    return Promise.resolve(cached[alias].login)
  }

  const failedAt = failedLookups.get(alias)
  if (failedAt !== undefined && now() - failedAt < FailureBackoff) {
    return Promise.resolve(null)
  }

  const pending = pendingLookups.get(alias)
  if (pending !== undefined) {
    return pending
  }

  const lookup = readGreeting(alias)
    .then(parseSSHGreeting)
    .catch(() => null)
    .then(login => {
      pendingLookups.delete(alias)

      if (login === null) {
        failedLookups.set(alias, now())
      } else {
        failedLookups.delete(alias)
        setObject(CachedLoginsKey, {
          ...(getObject<Record<string, ICachedLogin>>(CachedLoginsKey) ?? {}),
          [alias]: { login, identityFiles },
        })
      }

      return login
    })

  pendingLookups.set(alias, lookup)
  return lookup
}
