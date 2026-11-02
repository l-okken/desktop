import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

import {
  getRemoteSSHAlias,
  getSSHHostConfig,
  loadSSHConfig,
  parseSSHConfig,
  resolveRemoteHostname,
  resolveSSHHost,
} from '../../src/lib/ssh/ssh-config'

const realWorldConfig = `
# Aparte GitHub-identiteit
Host github.com-roling
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_rolingschilderwerken
  IdentitiesOnly yes

Host bitbucket.org
  AddKeysToAgent yes
  IdentityFile ~/.ssh/bitbucketkey

Host github-solatt
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_solatt
`

describe('ssh-config', () => {
  describe('resolveSSHHost', () => {
    it('resolves aliases regardless of their naming convention', async () => {
      const blocks = await parseSSHConfig(realWorldConfig)

      for (const alias of ['github-solatt', 'github.com-roling']) {
        assert.equal(resolveSSHHost(blocks, alias).hostName, 'github.com')
      }
      assert.deepEqual(resolveSSHHost(blocks, 'github-solatt').identityFiles, [
        '~/.ssh/id_ed25519_solatt',
      ])
    })

    it('leaves hosts without a HostName alone', async () => {
      const blocks = await parseSSHConfig(realWorldConfig)
      assert.equal(
        resolveSSHHost(blocks, 'bitbucket.org').hostName,
        'bitbucket.org'
      )
      assert.equal(resolveSSHHost(blocks, 'unknown').hostName, 'unknown')
    })

    it('uses the first HostName that applies', async () => {
      const blocks = await parseSSHConfig(
        'Host work\n  HostName first\nHost *\n  HostName second\n'
      )
      assert.equal(resolveSSHHost(blocks, 'work').hostName, 'first')
      assert.equal(resolveSSHHost(blocks, 'other').hostName, 'second')
    })

    it('handles several patterns, wildcards, and negation', async () => {
      const blocks = await parseSSHConfig(
        'Host one two gh-* !gh-private\n  HostName github.com\n'
      )
      for (const host of ['one', 'two', 'gh-work', 'GH-WORK']) {
        assert.equal(resolveSSHHost(blocks, host).hostName, 'github.com', host)
      }
      for (const host of ['three', 'gh-private']) {
        assert.equal(resolveSSHHost(blocks, host).hostName, host, host)
      }
    })

    it('does not treat a dot in a pattern as a wildcard', async () => {
      const blocks = await parseSSHConfig('Host a.b\n  HostName github.com\n')
      assert.equal(resolveSSHHost(blocks, 'axb').hostName, 'axb')
    })

    it('expands the %h token', async () => {
      const blocks = await parseSSHConfig(
        'Host gh\n  HostName %h.example.com\n'
      )
      assert.equal(resolveSSHHost(blocks, 'gh').hostName, 'gh.example.com')
    })

    it('supports the key=value syntax, quotes, and comments', async () => {
      const blocks = await parseSSHConfig(
        'host = gh # comment\nHOSTNAME="github.com"\nIdentityFile "~/my keys/id"\n'
      )
      const config = resolveSSHHost(blocks, 'gh')
      assert.equal(config.hostName, 'github.com')
      assert.deepEqual(config.identityFiles, ['~/my keys/id'])
    })

    it('applies directives before the first Host to all hosts', async () => {
      const blocks = await parseSSHConfig(
        'IdentityFile ~/.ssh/global\nHost gh\n  IdentityFile ~/.ssh/gh\n'
      )
      assert.deepEqual(resolveSSHHost(blocks, 'gh').identityFiles, [
        '~/.ssh/global',
        '~/.ssh/gh',
      ])
    })

    it('never applies Match blocks', async () => {
      const blocks = await parseSSHConfig(
        'Match host gh\n  HostName github.com\n'
      )
      assert.equal(resolveSSHHost(blocks, 'gh').hostName, 'gh')
    })

    it('reads Include directives', async () => {
      const blocks = await parseSSHConfig('Include extra\n', async pattern =>
        pattern === 'extra' ? ['Host gh\n  HostName github.com\n'] : []
      )
      assert.equal(resolveSSHHost(blocks, 'gh').hostName, 'github.com')
    })

    it('stops at Include directives which include themselves', async () => {
      const text = 'Include self\nHost gh\n  HostName github.com\n'
      const blocks = await parseSSHConfig(text, async () => [text])
      assert.equal(resolveSSHHost(blocks, 'gh').hostName, 'github.com')
    })
  })

  describe('loadSSHConfig', () => {
    let directory: string | undefined

    afterEach(async () => {
      if (directory !== undefined) {
        await rm(directory, { recursive: true, force: true })
        directory = undefined
      }
      await loadSSHConfig(Path.join(tmpdir(), 'does-not-exist'))
    })

    async function createSSHDirectory() {
      directory = await mkdtemp(Path.join(tmpdir(), 'ssh-config-'))
      const sshDirectory = Path.join(directory, '.ssh')
      await mkdir(sshDirectory)
      return sshDirectory
    }

    it('caches the config file and follows Include globs', async () => {
      const sshDirectory = await createSSHDirectory()
      await mkdir(Path.join(sshDirectory, 'config.d'))
      await writeFile(
        Path.join(sshDirectory, 'config'),
        'Include config.d/*\r\nHost main\r\n  HostName github.com\r\n'
      )
      await writeFile(
        Path.join(sshDirectory, 'config.d', 'work'),
        'Host work\n  HostName github.com\n'
      )

      await loadSSHConfig(sshDirectory)

      assert.equal(getSSHHostConfig('main').hostName, 'github.com')
      assert.equal(getSSHHostConfig('work').hostName, 'github.com')
    })

    it('treats a missing config file as an empty one', async () => {
      const sshDirectory = await createSSHDirectory()
      await loadSSHConfig(sshDirectory)
      assert.equal(getSSHHostConfig('main').hostName, 'main')
    })

    it('only resolves aliases for SSH remotes', async () => {
      const sshDirectory = await createSSHDirectory()
      await writeFile(
        Path.join(sshDirectory, 'config'),
        'Host gh\n  HostName github.com\n'
      )
      await loadSSHConfig(sshDirectory)

      const ssh = { protocol: 'ssh', hostname: 'gh' }
      const https = { protocol: 'https', hostname: 'gh' }

      assert.equal(resolveRemoteHostname(ssh), 'github.com')
      assert.equal(getRemoteSSHAlias(ssh), 'gh')
      assert.equal(resolveRemoteHostname(https), 'gh')
      assert.equal(getRemoteSSHAlias(https), null)
      assert.equal(
        getRemoteSSHAlias({ protocol: 'ssh', hostname: 'github.com' }),
        null
      )
    })
  })
})
