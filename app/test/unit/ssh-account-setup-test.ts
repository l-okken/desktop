import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import {
  addSSHHostBlock,
  createSSHKey,
  getDefaultSSHAlias,
  getSSHKeyPath,
  isValidSSHIdentifier,
  parseUnexpectedUsers,
} from '../../src/lib/ssh/ssh-account-setup'
import { getSSHHostConfig, loadSSHConfig } from '../../src/lib/ssh/ssh-config'
import {
  forgetSSHAliasLookupFailure,
  getLoginForSSHAlias,
  resetSSHAliasLoginState,
} from '../../src/lib/ssh/ssh-alias-login'

describe('ssh account setup', () => {
  let home: string
  const sshDirectory = () => Path.join(home, '.ssh')
  const configPath = () => Path.join(sshDirectory(), 'config')

  beforeEach(async () => {
    home = await mkdtemp(Path.join(tmpdir(), 'ssh-account-setup-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    await loadSSHConfig(Path.join(tmpdir(), 'does-not-exist'))
  })

  it('follows the naming convention of the existing setup', () => {
    assert.equal(getDefaultSSHAlias('work'), 'github-work')
    assert.equal(
      getSSHKeyPath('work', 'home'),
      Path.join('home', '.ssh', 'id_ed25519_work')
    )
  })

  it('only accepts values that are safe as file names and hosts', () => {
    for (const value of ['work', 'github.com-roling', 'a_b-c']) {
      assert.ok(isValidSSHIdentifier(value), value)
    }
    for (const value of ['', '-oEvil', 'a b', '../x', 'a/b', 'a\\b', 'a\nb']) {
      assert.ok(!isValidSSHIdentifier(value), value)
    }
  })

  describe('createSSHKey', () => {
    it('creates a real key with the right comment', async () => {
      const { publicKey, created } = await createSSHKey(
        'work@example.com',
        'work',
        home
      )

      assert.equal(created, true)
      assert.ok(publicKey.startsWith('ssh-ed25519 '))
      assert.ok(publicKey.endsWith(' work@example.com'))
      assert.deepEqual((await readdir(sshDirectory())).sort(), [
        'id_ed25519_work',
        'id_ed25519_work.pub',
      ])
    })

    it('never overwrites an existing key', async () => {
      await mkdir(sshDirectory())
      const keyPath = getSSHKeyPath('work', home)
      await writeFile(keyPath, 'existing private key')
      await writeFile(`${keyPath}.pub`, 'existing public key\n')

      let keygenCalls = 0
      const result = await createSSHKey(
        'work@example.com',
        'work',
        home,
        async () => {
          keygenCalls++
        }
      )

      assert.equal(keygenCalls, 0)
      assert.equal(result.created, false)
      assert.equal(result.publicKey, 'existing public key')
      assert.equal(await readFile(keyPath, 'utf8'), 'existing private key')
    })

    it('fails if there is a private key without a public key', async () => {
      await mkdir(sshDirectory())
      await writeFile(getSSHKeyPath('work', home), 'existing private key')

      await assert.rejects(createSSHKey('a@example.com', 'work', home))
    })

    it('refuses an identifier that could escape the folder', async () => {
      await assert.rejects(createSSHKey('a@example.com', '../evil', home))
      await assert.rejects(readdir(sshDirectory()))
    })
  })

  describe('addSSHHostBlock', () => {
    it('creates the config file if needed', async () => {
      assert.equal(await addSSHHostBlock('github-work', 'work', home), true)

      await loadSSHConfig(sshDirectory())
      const config = getSSHHostConfig('github-work')
      assert.equal(config.hostName, 'github.com')
      assert.deepEqual(config.identityFiles, ['~/.ssh/id_ed25519_work'])
      assert.deepEqual(await readdir(sshDirectory()), ['config'])
    })

    it('appends and makes a backup, leaving the rest as it was', async () => {
      await mkdir(sshDirectory())
      const own = '# My comment\r\nHost other\r\n  HostName example.com'
      await writeFile(configPath(), own)

      await addSSHHostBlock('github-work', 'work', home, () => 1)

      const updated = await readFile(configPath(), 'utf8')
      assert.ok(updated.startsWith(`${own}\r\n\r\nHost github-work\r\n`))
      assert.equal(updated.replace(/\r\n/g, '').includes('\n'), false)
      assert.equal(await readFile(`${configPath()}.bak-1`, 'utf8'), own)
    })

    it('is idempotent and leaves existing aliases alone', async () => {
      await mkdir(sshDirectory())
      const own = 'Host one GitHub-Work\n  HostName example.com\n'
      await writeFile(configPath(), own)

      assert.equal(await addSSHHostBlock('github-work', 'work', home), false)

      assert.equal(await readFile(configPath(), 'utf8'), own)
      assert.deepEqual(await readdir(sshDirectory()), ['config'])
    })

    it('refuses an alias which could inject directives', async () => {
      await assert.rejects(
        addSSHHostBlock('x\n  ProxyCommand evil', 'work', home)
      )
      await assert.rejects(readdir(sshDirectory()))
    })
  })

  describe('parseUnexpectedUsers', () => {
    // The actual output of icacls on a Dutch Windows installation.
    const output = [
      'C:\\Users\\ICT\\.ssh\\config NT AUTHORITY\\SYSTEM:(I)(F)',
      '                         INGEBOUWD\\Administrators:(I)(F)',
      '                         LAPTOP-DEUADV1C\\ICT:(I)(F)',
      '                         LAPTOP-DEUADV1C\\Lennart:(I)(F)',
      '',
      'Successfully processed 1 files; Failed processing 0 files',
    ].join('\r\n')

    it('finds users which Windows OpenSSH would refuse', () => {
      assert.deepEqual(parseUnexpectedUsers(output, 'ICT'), [
        'LAPTOP-DEUADV1C\\Lennart',
      ])
    })

    it('accepts the current user and system accounts', () => {
      assert.deepEqual(parseUnexpectedUsers(output, 'lennart').length, 1)
      assert.deepEqual(
        parseUnexpectedUsers(
          'C:\\a b\\c NT AUTHORITY\\SYSTEM:(F)\r\n   PC\\ict:(F)',
          'ICT'
        ),
        []
      )
    })
  })

  describe('forgetSSHAliasLookupFailure', () => {
    it('checks again right away after adding a key', async () => {
      localStorage.clear()
      resetSSHAliasLoginState()
      let calls = 0
      const read = async () =>
        ++calls === 1
          ? 'Permission denied (publickey).'
          : "Hi work! You've successfully authenticated, but GitHub does not provide shell access."

      assert.equal(await getLoginForSSHAlias('github-work', read), null)
      assert.equal(await getLoginForSSHAlias('github-work', read), null)
      assert.equal(calls, 1)

      forgetSSHAliasLookupFailure('github-work')
      assert.equal(await getLoginForSSHAlias('github-work', read), 'work')
    })
  })
})
