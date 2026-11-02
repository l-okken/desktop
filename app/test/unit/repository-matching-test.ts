import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import {
  matchGitHubRepository,
  urlMatchesRemote,
  urlMatchesCloneURL,
  urlsMatch,
} from '../../src/lib/repository-matching'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'
import * as Path from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { loadSSHConfig } from '../../src/lib/ssh/ssh-config'

describe('repository-matching', () => {
  describe('matchGitHubRepository', () => {
    it('matches HTTPS URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches HTTPS URLs without the git extension', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches git URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'git:github.com/someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches SSH URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'git@github.com:someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it(`doesn't match if there aren't any users with that endpoint`, () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://github.babbageinc.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo.git'
      )
      assert(repo === null)
    })
  })

  describe('urlMatchesRemote', () => {
    describe('with HTTPS remote', () => {
      const remote = {
        name: 'origin',
        url: 'https://github.com/shiftkey/desktop',
      }
      const remoteWithSuffix = {
        name: 'origin',
        url: 'https://github.com/shiftkey/desktop.git',
      }

      it('does not match null', () => {
        assert(!urlMatchesRemote(null, remoteWithSuffix))
      })

      it('matches cloneURL from API', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('matches cloneURL from API with different casing', () => {
        const cloneURL = 'https://GITHUB.COM/SHIFTKEY/DESKTOP.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('matches cloneURL from API without suffix', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remote))
      })

      it('matches htmlURL from API', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remoteWithSuffix))
      })

      it('matches htmlURL from API with different casing', () => {
        const htmlURL = 'https://GITHUB.COM/SHIFTKEY/DESKTOP'
        assert(urlMatchesRemote(htmlURL, remoteWithSuffix))
      })

      it('matches htmlURL from API without suffix', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remote))
      })
    })

    describe('with SSH remote', () => {
      const remote = {
        name: 'origin',
        url: 'git@github.com:shiftkey/desktop.git',
      }
      it('does not match null', () => {
        assert(!urlMatchesRemote(null, remote))
      })

      it('matches cloneURL from API', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remote))
      })

      it('matches htmlURL from API', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remote))
      })
    })
  })

  describe('cloneUrlMatches', () => {
    const repository = gitHubRepoFixture({
      name: 'desktop',
      owner: 'shiftkey',
      isPrivate: false,
    })

    const repositoryWithoutCloneURL: GitHubRepository = {
      dbID: 1,
      name: 'desktop',
      fullName: 'shiftkey/desktop',
      cloneURL: null,
      owner: {
        login: 'shiftkey',
        id: 1234,
        endpoint: 'https://api.github.com/',
      },
      isPrivate: false,
      htmlURL: 'https://github.com/shiftkey/desktop',
      parent: null,
      endpoint: 'https://api.github.com/',
      fork: true,
      hash: 'whatever',
      issuesEnabled: true,
      isArchived: false,
      permissions: null,
    }

    it('returns true for exact match', () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/shiftkey/desktop.git',
          repository
        ),
        true
      )
    })

    it(`returns true when URL doesn't have a .git suffix`, () => {
      assert.equal(
        urlMatchesCloneURL('https://github.com/shiftkey/desktop', repository),
        true
      )
    })

    it(`returns false when URL belongs to a different owner`, () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/outofambit/desktop.git',
          repository
        ),
        false
      )
    })

    it(`returns false if GitHub repository does't have a cloneURL set`, () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/shiftkey/desktop',
          repositoryWithoutCloneURL
        ),
        false
      )
    })
  })

  describe('SSH host aliases', () => {
    let directory: string

    before(async () => {
      directory = await mkdtemp(Path.join(tmpdir(), 'repository-matching-'))
      await writeFile(
        Path.join(directory, 'config'),
        [
          'Host github-solatt github.com-roling',
          '  HostName github.com',
          'Host gitlab-work',
          '  HostName gitlab.com',
        ].join('\n')
      )
      await loadSSHConfig(directory)
    })

    after(async () => {
      await rm(directory, { recursive: true, force: true })
      await loadSSHConfig(Path.join(directory, 'missing'))
    })

    const account = new Account(
      'alovelace',
      'https://api.github.com',
      '',
      [],
      '',
      1,
      '',
      'free'
    )

    it('matches a remote using an alias of the host', () => {
      for (const remote of [
        'git@github-solatt:solatt-com/sol-r.git',
        'git@github.com-roling:solatt-com/sol-r.git',
        'ssh://git@github-solatt/solatt-com/sol-r.git',
      ]) {
        const match = matchGitHubRepository([account], remote)
        assert.equal(match?.owner, 'solatt-com', remote)
        assert.equal(match?.name, 'sol-r', remote)
      }
    })

    it('does not match an alias of another host', () => {
      assert.equal(
        matchGitHubRepository([account], 'git@gitlab-work:owner/repo.git'),
        null
      )
      assert.equal(
        matchGitHubRepository([account], 'git@unknown-alias:owner/repo.git'),
        null
      )
    })

    it('does not resolve aliases for HTTPS remotes', () => {
      assert.equal(
        matchGitHubRepository(
          [account],
          'https://github-solatt/owner/repo.git'
        ),
        null
      )
    })

    it('compares aliases by the host they point to', () => {
      const remote = {
        name: 'origin',
        url: 'git@github-solatt:solatt-com/sol-r.git',
      }
      assert(
        urlMatchesRemote('https://github.com/solatt-com/sol-r.git', remote)
      )
      assert(!urlMatchesRemote('https://github.com/other/sol-r.git', remote))
      assert(
        !urlMatchesRemote('https://gitlab.com/solatt-com/sol-r.git', remote)
      )
      assert(
        urlsMatch(
          'git@github-solatt:solatt-com/sol-r.git',
          'https://github.com/solatt-com/sol-r.git'
        )
      )
    })
  })
})
