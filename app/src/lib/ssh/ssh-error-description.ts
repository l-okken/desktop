const WindowsOpenSSHHint = __WIN32__
  ? ' Turning off "Use system OpenSSH" in File > Options > Advanced also avoids this check.'
  : ''

/**
 * Get a description of an SSH failure whose real cause is in the output of Git.
 *
 * Git reports all of these as not being able to read from the remote, which
 * says nothing about what the user has to do. Returns null for all other
 * failures, which do fit the general description of an authentication failure.
 */
export function getSSHErrorDescription(stderr: string): string | null {
  const badConfig = /^Bad owner or permissions on (.+?)\r?$/m.exec(stderr)
  if (badConfig !== null) {
    const user = /Try removing permissions for user: (.+?) \(/.exec(stderr)
    const who =
      user !== null ? `the user ${user[1].replace(/\\\\/g, '\\')}` : 'others'

    return `SSH refused to read ${badConfig[1].replace(
      /\\\\/g,
      '\\'
    )} because ${who} can access that file as well. Remove those permissions from the file.${WindowsOpenSSHHint}`
  }

  const unprotectedKey = /^Permissions for '(.+?)' are too open/m.exec(stderr)
  if (
    unprotectedKey !== null ||
    stderr.includes('UNPROTECTED PRIVATE KEY FILE')
  ) {
    const key = unprotectedKey !== null ? unprotectedKey[1] : 'your private key'

    return `SSH refused to use ${key} because others can access that file as well. Remove those permissions from the file.${WindowsOpenSSHHint}`
  }

  const unknownHost = /^ssh: Could not resolve hostname (.+?):/m.exec(stderr)
  if (unknownHost !== null) {
    const host = unknownHost[1]

    return `SSH could not find the host "${host}". If this is an alias for GitHub, add a "Host ${host}" block to ~/.ssh/config or change the remote of this repository. Otherwise, check your Internet connection and try again.`
  }

  return null
}
