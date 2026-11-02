import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import {
  getAccountForRepositoryReference,
  linkRepositoryToAccount,
} from '../../src/lib/repository-accounts'
import { matchGitHubRepository } from '../../src/lib/repository-matching'
import { findAccountForCredentialUrl } from '../../src/lib/trampoline/find-account'
import {
  getLoginForSSHAlias,
  parseSSHGreeting,
  resetSSHAliasLoginState,
} from '../../src/lib/ssh/ssh-alias-login'

const endpoint = 'https://api.github.com'

const createAccount = (login: string, id: number) =>
  new Account(login, endpoint, `token-${login}`, [], '', id, login)

const reference = (owner: string, name: string) => ({
  endpoint,
  owner: { login: owner },
  name,
})

describe('repository accounts', () => {
  const personal = createAccount('personal', 1)
  const work = createAccount('work', 2)
  const accounts = [personal, work]

  beforeEach(() => {
    localStorage.clear()
    resetSSHAliasLoginState()
  })

  describe('getAccountForRepositoryReference', () => {
    it('uses the linked account', () => {
      linkRepositoryToAccount(reference('some-org', 'repo'), 'work')
      assert.equal(
        getAccountForRepositoryReference(
          accounts,
          reference('Some-Org', 'REPO')
        ),
        work
      )
    })

    it('never uses another token if the linked account is signed out', () => {
      linkRepositoryToAccount(reference('some-org', 'repo'), 'work')
      assert.equal(
        getAccountForRepositoryReference(
          [personal],
          reference('some-org', 'repo')
        ),
        null
      )
    })

    it('prefers the owner over the first account without a link', () => {
      assert.equal(
        getAccountForRepositoryReference(accounts, reference('work', 'repo')),
        work
      )
      assert.equal(
        getAccountForRepositoryReference(accounts, reference('other', 'repo')),
        personal
      )
    })

    it('ignores accounts on other endpoints', () => {
      const enterprise = new Account(
        'work',
        'https://ghe.example.com/api/v3',
        '',
        [],
        '',
        3,
        ''
      )
      assert.equal(
        getAccountForRepositoryReference(
          [enterprise],
          reference('work', 'repo')
        ),
        null
      )
    })
  })

  describe('matchGitHubRepository', () => {
    const remote = 'https://github.com/some-org/repo.git'

    it('uses the requested login', () => {
      assert.equal(
        matchGitHubRepository(accounts, remote, 'work')?.account,
        work
      )
    })

    it('does not match if the requested login is signed out', () => {
      assert.equal(matchGitHubRepository([personal], remote, 'work'), null)
    })

    it('uses the link, then the owner, then the first account', () => {
      assert.equal(matchGitHubRepository(accounts, remote)?.account, personal)
      assert.equal(
        matchGitHubRepository(accounts, 'https://github.com/work/repo.git')
          ?.account,
        work
      )
      linkRepositoryToAccount(reference('some-org', 'repo'), 'work')
      assert.equal(matchGitHubRepository(accounts, remote)?.account, work)
    })

    it('behaves the same with one account', () => {
      assert.equal(matchGitHubRepository([personal], remote)?.account, personal)
    })
  })

  describe('findAccountForCredentialUrl', () => {
    it('uses the path of the repository to pick the account', () => {
      linkRepositoryToAccount(reference('some-org', 'repo'), 'work')
      assert.equal(
        findAccountForCredentialUrl(
          accounts,
          'https://github.com/some-org/repo.git'
        ),
        work
      )
      assert.equal(
        findAccountForCredentialUrl(
          accounts,
          'https://github.com/work/other.git/info/lfs'
        ),
        work
      )
    })

    it('uses the first account without a path', () => {
      assert.equal(
        findAccountForCredentialUrl(accounts, 'https://github.com/'),
        personal
      )
    })

    it('never hands out another token if the linked account is signed out', () => {
      linkRepositoryToAccount(reference('some-org', 'repo'), 'work')
      assert.equal(
        findAccountForCredentialUrl(
          [personal],
          'https://github.com/some-org/repo.git'
        ),
        undefined
      )
    })

    it('ignores accounts on other hosts', () => {
      assert.equal(
        findAccountForCredentialUrl(
          accounts,
          'https://ghe.example.com/some-org/repo.git'
        ),
        undefined
      )
    })
  })

  describe('parseSSHGreeting', () => {
    it('finds the login', () => {
      assert.equal(
        parseSSHGreeting(
          "Warning: something\nHi some-user! You've successfully authenticated, but GitHub does not provide shell access.\n"
        ),
        'some-user'
      )
    })

    it('ignores deploy keys and failures', () => {
      assert.equal(
        parseSSHGreeting(
          "Hi owner/repo! You've successfully authenticated, but GitHub does not provide shell access."
        ),
        null
      )
      assert.equal(parseSSHGreeting('Permission denied (publickey).'), null)
    })
  })

  describe('getLoginForSSHAlias', () => {
    const greeting = (login: string) =>
      `Hi ${login}! You've successfully authenticated, but GitHub does not provide shell access.`

    it('only asks once', async () => {
      let calls = 0
      const read = async () => {
        calls++
        return greeting('work')
      }

      const [first, second] = await Promise.all([
        getLoginForSSHAlias('github-work', read),
        getLoginForSSHAlias('github-work', read),
      ])
      assert.equal(first, 'work')
      assert.equal(second, 'work')
      assert.equal(await getLoginForSSHAlias('github-work', read), 'work')
      assert.equal(calls, 1)
    })

    it('backs off after a failure and retries afterwards', async () => {
      let now = 0
      let calls = 0
      const read = async () => {
        calls++
        return calls === 1 ? 'Permission denied (publickey).' : greeting('work')
      }

      const lookup = () => getLoginForSSHAlias('github-work', read, () => now)

      assert.equal(await lookup(), null)
      now += 1000
      assert.equal(await lookup(), null)
      assert.equal(calls, 1)
      now += 5 * 60 * 1000
      assert.equal(await lookup(), 'work')
    })

    it('does not fail if ssh can not be started', async () => {
      const read = async () => {
        throw new Error('ENOENT')
      }
      assert.equal(await getLoginForSSHAlias('github-work', read), null)
    })

    it('refuses anything that is not a hostname', async () => {
      let calls = 0
      const read = async () => {
        calls++
        return greeting('work')
      }
      for (const alias of ['-oProxyCommand=evil', 'a b', 'a;b', '']) {
        assert.equal(await getLoginForSSHAlias(alias, read), null, alias)
      }
      assert.equal(calls, 0)
    })
  })
})
