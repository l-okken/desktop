import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { exec } from 'dugite'
import { Repository } from '../../src/models/repository'
import {
  getGroupKey,
  groupRepositories,
} from '../../src/ui/repositories-list/group-repositories'
import { IRepositoryGroup } from '../../src/models/repository-group'
import {
  findRepositoryGroup,
  getGroupNameFromAlias,
  getRemoteUrlForAlias,
} from '../../src/lib/repository-groups'
import {
  hasOwnIncludeForAlias,
  syncManagedGitConfig,
  updateManagedBlock,
} from '../../src/lib/git/managed-git-config'

const createGroup = (
  overrides: Partial<IRepositoryGroup> = {}
): IRepositoryGroup => ({
  id: 1,
  name: 'work',
  sshHostAlias: 'github-work',
  accountLogin: 'work-login',
  userName: 'Work Name',
  userEmail: 'work@example.com',
  rootPath: null,
  ...overrides,
})

describe('repository groups', () => {
  describe('findRepositoryGroup', () => {
    const work = createGroup()
    const folder = createGroup({
      id: 2,
      sshHostAlias: 'github-other',
      rootPath: Path.resolve('code', 'other'),
    })
    const groups = [work, folder]

    it('finds the group by alias, ignoring case', () => {
      assert.equal(findRepositoryGroup(groups, 'x', 'GitHub-Work'), work)
    })

    it('finds the group by folder', () => {
      const inside = Path.resolve('code', 'other', 'repo')
      assert.equal(findRepositoryGroup(groups, inside, undefined), folder)
    })

    it('does not match a folder with the same prefix', () => {
      const sibling = Path.resolve('code', 'other-thing', 'repo')
      assert.equal(findRepositoryGroup(groups, sibling, undefined), null)
    })

    it('prefers the alias over the folder', () => {
      const inside = Path.resolve('code', 'other', 'repo')
      assert.equal(findRepositoryGroup(groups, inside, 'github-work'), work)
    })

    it('finds nothing for an unknown alias outside of any folder', () => {
      assert.equal(findRepositoryGroup(groups, 'x', 'github-nope'), null)
    })
  })

  describe('getRemoteUrlForAlias', () => {
    it('rewrites all kinds of URLs', () => {
      for (const url of [
        'https://github.com/owner/repo.git',
        'https://github.com/owner/repo',
        'git@github.com:owner/repo.git',
        'git@github-old:owner/repo.git',
        'owner/repo',
        '  owner/repo  ',
      ]) {
        assert.equal(
          getRemoteUrlForAlias(url, 'github-work'),
          'git@github-work:owner/repo.git',
          url
        )
      }
    })

    it('refuses what does not identify a repository', () => {
      assert.equal(getRemoteUrlForAlias('not a url', 'github-work'), null)
    })
  })

  it('makes up a name from the alias', () => {
    assert.equal(getGroupNameFromAlias('github-solatt'), 'solatt')
    assert.equal(getGroupNameFromAlias('github.com-roling'), 'roling')
    assert.equal(getGroupNameFromAlias('custom'), 'custom')
  })

  describe('updateManagedBlock', () => {
    const lines = ['[includeIf "x"]', '\tpath = "y"']

    it('leaves everything around the block alone', () => {
      const own = '[user]\n\tuseConfigOnly = true\n'
      const first = updateManagedBlock(own, lines)
      assert.ok(first.startsWith(own))

      const withTail = `${first}[core]\n\tautocrlf = true\n`
      const second = updateManagedBlock(withTail, ['[includeIf "z"]'])
      assert.ok(second.startsWith(own))
      assert.ok(second.endsWith('[core]\n\tautocrlf = true\n'))
      assert.ok(second.includes('[includeIf "z"]'))
      assert.ok(!second.includes('[includeIf "x"]'))
    })

    it('is idempotent', () => {
      const once = updateManagedBlock('[a]\n', lines)
      assert.equal(updateManagedBlock(once, lines), once)
    })

    it('restores the original when the block goes away', () => {
      const own = '[user]\n\tname = x\n'
      const added = updateManagedBlock(own, lines)
      assert.equal(updateManagedBlock(added, []), own)
    })

    it('keeps the line endings of the file', () => {
      const updated = updateManagedBlock('[a]\r\n', lines)
      assert.equal(updated.replace(/\r\n/g, '').includes('\n'), false)
    })

    it('adds a newline to a file which does not end in one', () => {
      assert.ok(updateManagedBlock('[a]', lines).startsWith('[a]\n# >>>'))
    })
  })

  describe('syncManagedGitConfig', () => {
    let home: string
    const configPath = () => Path.join(home, '.gitconfig')
    const backups = async () =>
      (await readdir(home)).filter(f => f.startsWith('.gitconfig.bak-'))

    beforeEach(async () => {
      home = await mkdtemp(Path.join(tmpdir(), 'managed-git-config-'))
    })

    afterEach(async () => {
      await rm(home, { recursive: true, force: true })
    })

    /** Ask real Git which email a repository with the given remote gets. */
    async function getEmailInRepository(remote: string, folder = 'repo') {
      const path = Path.join(home, folder)
      await mkdir(path, { recursive: true })
      const env = {
        GIT_CONFIG_GLOBAL: configPath(),
        GIT_CONFIG_NOSYSTEM: '1',
      }
      await exec(['init', '-q'], path, { env })
      await exec(['remote', 'add', 'origin', remote], path, { env })
      const { stdout } = await exec(['config', 'user.email'], path, { env })
      return stdout.toString().trim()
    }

    it('gives repositories using the alias the identity of the group', async () => {
      await syncManagedGitConfig([createGroup()], [], home)

      assert.equal(
        await getEmailInRepository('git@github-work:owner/repo.git'),
        'work@example.com'
      )
      assert.equal(
        await getEmailInRepository('git@github-other:owner/repo.git', 'other'),
        ''
      )
    })

    it('gives repositories in the folder of a group its identity', async () => {
      const rootPath = Path.join(home, 'work-folder')
      await syncManagedGitConfig([createGroup({ rootPath })], [], home)

      assert.equal(
        await getEmailInRepository(
          'git@github.com:owner/repo.git',
          Path.join('work-folder', 'repo')
        ),
        'work@example.com'
      )
    })

    it('handles quotes and backslashes in values', async () => {
      await syncManagedGitConfig(
        [createGroup({ userEmail: 'a"b\\c@example.com' })],
        [],
        home
      )
      assert.equal(
        await getEmailInRepository('git@github-work:owner/repo.git'),
        'a"b\\c@example.com'
      )
    })

    it('creates a backup before changing the config, once', async () => {
      const own = '[user]\n\tuseConfigOnly = true\n'
      await writeFile(configPath(), own)

      await syncManagedGitConfig([createGroup()], [], home, () => 1)
      assert.deepEqual(await backups(), ['.gitconfig.bak-1'])
      assert.equal(
        await readFile(Path.join(home, '.gitconfig.bak-1'), 'utf8'),
        own
      )

      await syncManagedGitConfig([createGroup()], [], home, () => 2)
      assert.deepEqual(await backups(), ['.gitconfig.bak-1'])
    })

    it('leaves an alias alone if the user already configured it', async () => {
      const own =
        '[includeIf "hasconfig:remote.*.url:git@github-work:*/**"]\n\tpath = C:/mine\n'
      await writeFile(configPath(), own)
      assert.ok(hasOwnIncludeForAlias(own, 'github-work'))

      await syncManagedGitConfig([createGroup()], [], home)

      assert.equal(await readFile(configPath(), 'utf8'), own)
      assert.deepEqual(await backups(), [])
      assert.ok(!(await readdir(home)).some(f => f.includes('forkdesk')))
    })

    it('does not count its own block as the configuration of the user', async () => {
      await syncManagedGitConfig([createGroup()], [], home)
      const contents = await readFile(configPath(), 'utf8')
      assert.ok(!hasOwnIncludeForAlias(contents, 'github-work'))

      await syncManagedGitConfig([createGroup()], [], home)
      assert.equal(await readFile(configPath(), 'utf8'), contents)
    })

    it('skips groups without an identity', async () => {
      await syncManagedGitConfig(
        [createGroup({ userName: '', userEmail: '' })],
        [],
        home
      )
      assert.deepEqual(await readdir(home), [])
    })

    it('cleans up after removing a group', async () => {
      const own = '[user]\n\tuseConfigOnly = true\n'
      await writeFile(configPath(), own)
      const group = createGroup()
      await syncManagedGitConfig([group], [], home, () => 1)

      await syncManagedGitConfig([], [group], home, () => 2)

      assert.equal(await readFile(configPath(), 'utf8'), own)
      assert.ok(!(await readdir(home)).some(f => f.includes('forkdesk')))
    })

    it('does not delete a file it does not recognize', async () => {
      const group = createGroup()
      const path = Path.join(home, '.gitconfig-forkdesk-1')
      await writeFile(path, '[user]\n\tname = mine\n')

      await syncManagedGitConfig([], [group], home)

      assert.equal(await readFile(path, 'utf8'), '[user]\n\tname = mine\n')
    })
  })
})

describe('groupRepositories with custom groups', () => {
  const repo = (id: number, name: string) =>
    new Repository(Path.join('code', name), id, null, false)

  it('shows custom groups after recent ones and before all others', () => {
    const work = createGroup()
    const repositories = [repo(1, 'a'), repo(2, 'b')]
    const groups = groupRepositories(repositories, new Map(), [], r =>
      r.id === 1 ? work : null
    )

    assert.deepEqual(
      groups.map(g => g.identifier.kind),
      ['custom', 'other']
    )
    assert.deepEqual(
      groups[0].items.map(i => i.repository.id),
      [1]
    )
    assert.ok(
      getGroupKey({ kind: 'recent' }) <
        getGroupKey({ kind: 'custom', group: work })
    )
    assert.ok(
      getGroupKey({ kind: 'custom', group: work }) <
        getGroupKey({ kind: 'other' })
    )
  })

  it('leaves the existing groups alone without custom groups', () => {
    const groups = groupRepositories([repo(1, 'a')], new Map(), [])
    assert.deepEqual(
      groups.map(g => g.identifier.kind),
      ['other']
    )
  })
})
