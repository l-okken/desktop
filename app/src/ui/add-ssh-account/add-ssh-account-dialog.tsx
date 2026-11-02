import * as React from 'react'
import * as Os from 'os'
import * as Path from 'path'
import { Account, getAccountKey, isDotComAccount } from '../../models/account'
import { API } from '../../lib/api'
import { getGroupNameFromAlias } from '../../lib/repository-groups'
import {
  addSSHHostBlock,
  createSSHKey,
  getDefaultSSHAlias,
  getSSHKeyPath,
  getUnexpectedUsersOfFile,
  isValidSSHIdentifier,
} from '../../lib/ssh/ssh-account-setup'
import {
  forgetSSHAliasLookupFailure,
  getLoginForSSHAlias,
} from '../../lib/ssh/ssh-alias-login'
import { loadSSHConfig } from '../../lib/ssh/ssh-config'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LinkButton } from '../lib/link-button'
import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { writeClipboardText } from '../main-process-proxy'

const NewSSHKeyURL = 'https://github.com/settings/ssh/new'

interface IAddSSHAccountDialogProps {
  readonly dispatcher: Dispatcher
  readonly accounts: ReadonlyArray<Account>
  readonly onDismissed: () => void
}

interface IAddSSHAccountDialogState {
  readonly email: string
  readonly identifier: string
  /** What the user typed for the alias. Empty means using the default. */
  readonly alias: string
  /** The key of the account to upload the public key with, if any. */
  readonly uploadAccountKey: string
  readonly createGroup: boolean
  readonly commitName: string
  readonly busy: boolean
  readonly error: Error | null
  /** The public key, once the first step has completed. */
  readonly publicKey: string | null
  readonly notes: ReadonlyArray<string>
  /** The login which the key turned out to belong to. */
  readonly login: string | null
}

/** Automates creating a key and alias for another GitHub account. */
export class AddSSHAccountDialog extends React.Component<
  IAddSSHAccountDialogProps,
  IAddSSHAccountDialogState
> {
  public constructor(props: IAddSSHAccountDialogProps) {
    super(props)
    this.state = {
      email: '',
      identifier: '',
      alias: '',
      uploadAccountKey: '',
      createGroup: true,
      commitName: '',
      busy: false,
      error: null,
      publicKey: null,
      notes: [],
      login: null,
    }
  }

  private getAlias() {
    const { alias, identifier } = this.state
    return alias.trim() || getDefaultSSHAlias(identifier.trim())
  }

  public render() {
    return this.state.publicKey === null
      ? this.renderForm()
      : this.renderResult(this.state.publicKey)
  }

  private renderError() {
    const { error } = this.state
    return error !== null ? <DialogError>{error.message}</DialogError> : null
  }

  private renderForm() {
    const { email, identifier, alias, uploadAccountKey, busy } = this.state
    const isValid =
      email.includes('@') &&
      isValidSSHIdentifier(identifier.trim()) &&
      isValidSSHIdentifier(this.getAlias())

    return (
      <Dialog
        id="add-ssh-account"
        title={
          __DARWIN__ ? 'Add Account and SSH Key' : 'Add account and SSH key'
        }
        onDismissed={this.props.onDismissed}
        onSubmit={this.createKey}
        loading={busy}
        disabled={busy}
      >
        {this.renderError()}
        <DialogContent>
          <p>
            This creates an SSH key without a passphrase and adds an alias for
            it to <code>~/.ssh/config</code>, of which a backup is made first.
            Existing keys and aliases are never overwritten.
          </p>
          <Row>
            <TextBox
              label="Email address"
              autoFocus={true}
              value={email}
              onValueChanged={this.onEmailChanged}
            />
          </Row>
          <Row>
            <TextBox
              label="Identifier, such as work"
              value={identifier}
              onValueChanged={this.onIdentifierChanged}
            />
            <TextBox
              label="SSH host alias"
              value={alias}
              placeholder={this.getAlias()}
              onValueChanged={this.onAliasChanged}
            />
          </Row>
          <Row>
            <Select
              label="Upload the public key to GitHub"
              value={uploadAccountKey}
              onChange={this.onUploadAccountChanged}
            >
              <option value="">No, I'll add it myself</option>
              {this.props.accounts.filter(isDotComAccount).map(account => (
                <option key={account.login} value={getAccountKey(account)}>
                  Yes, to @{account.login}
                </option>
              ))}
            </Select>
          </Row>
          <Row>
            <Checkbox
              label="Create a group for this account"
              value={
                this.state.createGroup ? CheckboxValue.On : CheckboxValue.Off
              }
              onChange={this.onCreateGroupChanged}
            />
          </Row>
          {this.state.createGroup ? (
            <Row>
              <TextBox
                label="Name to commit with (optional)"
                value={this.state.commitName}
                onValueChanged={this.onCommitNameChanged}
              />
            </Row>
          ) : null}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Create key"
            okButtonDisabled={!isValid || busy}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderResult(publicKey: string) {
    const { login, notes, busy } = this.state

    return (
      <Dialog
        id="add-ssh-account"
        title={
          __DARWIN__ ? 'Add Account and SSH Key' : 'Add account and SSH key'
        }
        onDismissed={this.props.onDismissed}
        onSubmit={this.finish}
        loading={busy}
        disabled={busy}
      >
        {this.renderError()}
        <DialogContent>
          {notes.map(note => (
            <p key={note}>{note}</p>
          ))}
          <Row>
            <textarea readOnly={true} rows={3} value={publicKey} />
          </Row>
          <Row>
            <Button onClick={this.copyPublicKey}>Copy public key</Button>
            <LinkButton uri={NewSSHKeyURL}>Add it on GitHub</LinkButton>
          </Row>
          <Row>
            <Button onClick={this.verify}>Check connection</Button>
            {login !== null ? (
              <span>
                Connected to GitHub as <strong>@{login}</strong>.
              </span>
            ) : null}
          </Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Done"
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onEmailChanged = (email: string) => this.setState({ email })
  private onIdentifierChanged = (identifier: string) =>
    this.setState({ identifier })
  private onAliasChanged = (alias: string) => this.setState({ alias })
  private onCommitNameChanged = (commitName: string) =>
    this.setState({ commitName })
  private onUploadAccountChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => this.setState({ uploadAccountKey: event.currentTarget.value })
  private onCreateGroupChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ createGroup: event.currentTarget.checked })

  private copyPublicKey = () => {
    if (this.state.publicKey !== null) {
      writeClipboardText(this.state.publicKey)
    }
  }

  private createKey = async () => {
    const identifier = this.state.identifier.trim()
    const email = this.state.email.trim()
    const alias = this.getAlias()
    this.setState({ busy: true, error: null })

    try {
      const { publicKey, created } = await createSSHKey(email, identifier)
      const added = await addSSHHostBlock(alias, identifier)
      await loadSSHConfig()

      const notes = [
        created
          ? `Created the key ${getSSHKeyPath(identifier)}.`
          : `Using the existing key ${getSSHKeyPath(identifier)}.`,
        added
          ? `Added the alias "${alias}" to ~/.ssh/config.`
          : `The alias "${alias}" already exists and hasn't been changed. Check that it uses this key.`,
        ...(await this.getPermissionNotes(identifier)),
        await this.uploadPublicKey(publicKey, alias),
      ]

      this.setState({ busy: false, publicKey, notes })
      await this.verify()
    } catch (e) {
      log.error('Unable to set up the SSH key', e)
      this.setState({ busy: false, error: e })
    }
  }

  private async getPermissionNotes(identifier: string) {
    const files = [
      Path.join(Os.homedir(), '.ssh', 'config'),
      getSSHKeyPath(identifier),
    ]
    const notes = new Array<string>()

    for (const file of files) {
      const users = await getUnexpectedUsersOfFile(file)
      if (users.length > 0) {
        notes.push(
          `Warning: ${users.join(
            ', '
          )} can access ${file}. Windows OpenSSH refuses to use this file until those permissions are removed, unless "Use system OpenSSH" is turned off in File > Options > Advanced.`
        )
      }
    }

    return notes
  }

  private async uploadPublicKey(publicKey: string, alias: string) {
    const account = this.props.accounts.find(
      a => getAccountKey(a) === this.state.uploadAccountKey
    )

    if (account === undefined) {
      return 'Add this public key to your GitHub account, then check the connection.'
    }

    try {
      await API.fromAccount(account).createPublicKey(alias, publicKey)
      return `Added the public key to @${account.login}.`
    } catch (e) {
      log.warn('Unable to upload the public key', e)
      return `The public key couldn't be added to @${account.login}. Accounts need to sign in again to allow this, or the key is in use already. Add it yourself instead, then check the connection.`
    }
  }

  private verify = async () => {
    const alias = this.getAlias()
    this.setState({ busy: true, error: null })

    forgetSSHAliasLookupFailure(alias)
    const login = await getLoginForSSHAlias(alias)

    this.setState({
      busy: false,
      login,
      error:
        login === null
          ? new Error(
              `Can't connect to GitHub through "${alias}" yet. Keys can take a moment to become active after adding them.`
            )
          : null,
    })
  }

  private finish = async () => {
    const { createGroup, identifier, commitName, email } = this.state

    if (createGroup) {
      const alias = this.getAlias()
      await this.props.dispatcher.addRepositoryGroup({
        name: getGroupNameFromAlias(alias) || identifier.trim(),
        sshHostAlias: alias,
        userName: commitName.trim(),
        userEmail: email.trim(),
        rootPath: null,
      })
    }

    this.props.onDismissed()
  }
}
