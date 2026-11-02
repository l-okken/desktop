/** A group of repositories which all use the same GitHub identity. */
export interface IRepositoryGroup {
  readonly id: number
  readonly name: string
  /** The `Host` of `~/.ssh/config` which repositories in this group connect to. */
  readonly sshHostAlias: string
  /** The GitHub account the key of the alias belongs to, if known. */
  readonly accountLogin: string | null
  /** The name to commit with, or empty to leave it up to the Git config. */
  readonly userName: string
  /** The email to commit with, or empty to leave it up to the Git config. */
  readonly userEmail: string
  /** A folder whose repositories are part of the group whatever their remote. */
  readonly rootPath: string | null
}
