import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError } from 'dugite'
import { getSSHErrorDescription } from '../../src/lib/ssh/ssh-error-description'
import { getDescriptionForError } from '../../src/lib/git/core'

const readError = [
  'fatal: Could not read from remote repository.',
  '',
  'Please make sure you have the correct access rights',
  'and the repository exists.',
].join('\n')

// The output of Windows OpenSSH as found in the logs of the official app.
const badPermissions = [
  'Bad permissions. Try removing permissions for user: LAPTOP\\\\Someone (S-1-5-21-1-2-3-1001) on file C:/Users/ICT/.ssh/config.',
  'Bad owner or permissions on C:\\\\Users\\\\ICT/.ssh/config',
  readError,
].join('\r\n')

const unprotectedKey = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  "Permissions for 'C:\\Users\\ICT/.ssh/id_ed25519_work' are too open.",
  readError,
].join('\n')

const unknownHost = [
  'ssh: Could not resolve hostname github-steven: Host is onbekend. ',
  readError,
].join('\r\n')

describe('getSSHErrorDescription', () => {
  it('names the file and user for a config file with bad permissions', () => {
    const description = getSSHErrorDescription(badPermissions)
    assert.ok(description?.includes('C:\\Users\\ICT/.ssh/config'))
    assert.ok(description?.includes('LAPTOP\\Someone'))
    assert.ok(!description?.includes('\r'))
  })

  it('names the key for a private key with bad permissions', () => {
    const description = getSSHErrorDescription(unprotectedKey)
    assert.ok(description?.includes('id_ed25519_work'))
  })

  it('names the alias for a host which can not be resolved', () => {
    const description = getSSHErrorDescription(unknownHost)
    assert.ok(description?.includes('"github-steven"'))
    assert.ok(description?.includes('Host github-steven'))
  })

  it('leaves other failures alone', () => {
    assert.equal(
      getSSHErrorDescription(
        `git@github.com: Permission denied (publickey).\n${readError}`
      ),
      null
    )
  })
})

describe('getDescriptionForError', () => {
  it('prefers the actual cause over the general description', () => {
    const description = getDescriptionForError(
      GitError.SSHPermissionDenied,
      badPermissions
    )
    assert.ok(description?.startsWith('SSH refused to read'))
  })

  it('keeps the general description for other authentication failures', () => {
    const description = getDescriptionForError(
      GitError.SSHPermissionDenied,
      readError
    )
    assert.ok(description?.startsWith('Authentication failed.'))
  })
})
