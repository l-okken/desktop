import * as React from 'react'
import { IRepositoryGroup } from '../../models/repository-group'
import { getGroupNameFromAlias } from '../../lib/repository-groups'
import { getSSHAliases } from '../../lib/ssh/ssh-config'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'

interface IRepositoryGroupsProps {
  readonly groups: ReadonlyArray<IRepositoryGroup>
  readonly onAddGroup: (
    group: Omit<IRepositoryGroup, 'id' | 'accountLogin'>
  ) => void
  readonly onRemoveGroup: (group: IRepositoryGroup) => void
  /** Called when the user wants to add a new account and SSH key. */
  readonly onAddSSHAccount: () => void
}

interface IRepositoryGroupsState {
  readonly sshHostAlias: string
  readonly name: string
  readonly userName: string
  readonly userEmail: string
  readonly rootPath: string
}

const emptyForm = { name: '', userName: '', userEmail: '', rootPath: '' }

/**
 * Lets the user manage groups. Unlike the other tabs these changes are applied
 * immediately, as they don't fit the single save button of the preferences.
 */
export class RepositoryGroups extends React.Component<
  IRepositoryGroupsProps,
  IRepositoryGroupsState
> {
  public constructor(props: IRepositoryGroupsProps) {
    super(props)
    this.state = { sshHostAlias: '', ...emptyForm }
  }

  private getAvailableAliases() {
    const used = new Set(
      this.props.groups.map(g => g.sshHostAlias.toLowerCase())
    )
    return getSSHAliases().filter(alias => !used.has(alias.toLowerCase()))
  }

  private getSelectedAlias(available: ReadonlyArray<string>) {
    return available.includes(this.state.sshHostAlias)
      ? this.state.sshHostAlias
      : available.at(0) ?? ''
  }

  public render() {
    return (
      <DialogContent className="accounts-tab repository-groups-tab">
        <h2>Groups</h2>
        <p>
          A group shows repositories together in the sidebar and has them use
          the same SSH key and commit identity. Changes are applied immediately
          and add a managed section to your global Git configuration, of which a
          backup is made first.
        </p>
        {this.props.groups.map(this.renderGroup)}
        {this.renderForm()}
        <Row>
          <Button onClick={this.props.onAddSSHAccount}>
            Add account and SSH key…
          </Button>
        </Row>
      </DialogContent>
    )
  }

  private renderGroup = (group: IRepositoryGroup) => {
    const identity = [group.userName, group.userEmail]
      .filter(x => x.length > 0)
      .join(' · ')

    return (
      <Row className="account-info" key={group.id}>
        <div className="user-info-container">
          <div className="user-info">
            <div className="name">{group.name}</div>
            <div className="login">
              {group.sshHostAlias}
              {group.accountLogin !== null ? ` · @${group.accountLogin}` : ''}
            </div>
            {identity.length > 0 ? (
              <div className="login">{identity}</div>
            ) : null}
            {group.rootPath !== null ? (
              <div className="login">{group.rootPath}</div>
            ) : null}
          </div>
        </div>
        <Button onClick={this.getRemoveHandler(group)}>Remove</Button>
      </Row>
    )
  }

  private getRemoveHandler = (group: IRepositoryGroup) => () =>
    this.props.onRemoveGroup(group)

  private renderForm() {
    const available = this.getAvailableAliases()

    if (available.length === 0) {
      return (
        <p>
          All SSH host aliases of <code>~/.ssh/config</code> are in a group
          already.
        </p>
      )
    }

    const alias = this.getSelectedAlias(available)

    return (
      <div className="repository-group-form">
        <h2>New group</h2>
        <Row>
          <Select
            label="SSH host alias"
            value={alias}
            onChange={this.onAliasChanged}
          >
            {available.map(a => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Row>
        <Row>
          <TextBox
            label="Name"
            value={this.state.name}
            placeholder={getGroupNameFromAlias(alias)}
            onValueChanged={this.onNameChanged}
          />
        </Row>
        <Row>
          <TextBox
            label="Commit name (optional)"
            value={this.state.userName}
            onValueChanged={this.onUserNameChanged}
          />
        </Row>
        <Row>
          <TextBox
            label="Commit email (optional)"
            value={this.state.userEmail}
            onValueChanged={this.onUserEmailChanged}
          />
        </Row>
        <Row>
          <TextBox
            label="Folder (optional)"
            value={this.state.rootPath}
            onValueChanged={this.onRootPathChanged}
          />
        </Row>
        <Row>
          <Button onClick={this.onAdd}>Add group</Button>
        </Row>
      </div>
    )
  }

  private onAliasChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ sshHostAlias: event.currentTarget.value })
  private onNameChanged = (name: string) => this.setState({ name })
  private onUserNameChanged = (userName: string) => this.setState({ userName })
  private onUserEmailChanged = (userEmail: string) =>
    this.setState({ userEmail })
  private onRootPathChanged = (rootPath: string) => this.setState({ rootPath })

  private onAdd = () => {
    const alias = this.getSelectedAlias(this.getAvailableAliases())
    if (alias.length === 0) {
      return
    }

    const { name, userName, userEmail, rootPath } = this.state
    this.props.onAddGroup({
      name: name.trim() || getGroupNameFromAlias(alias),
      sshHostAlias: alias,
      userName: userName.trim(),
      userEmail: userEmail.trim(),
      rootPath: rootPath.trim() || null,
    })
    this.setState({ sshHostAlias: '', ...emptyForm })
  }
}
