import * as React from 'react'
import classNames from 'classnames'
import memoizeOne from 'memoize-one'
import { IConstrainedValue } from '../../lib/app-state'
import { IMatches } from '../../lib/fuzzy-find'
import { getStringArray, setStringArray } from '../../lib/local-storage'
import { Account } from '../../models/account'
import { IRepositoryGroup } from '../../models/repository-group'
import { ILocalRepositoryState } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  getGroupKey,
  getGroupLabel,
  groupUserRepositories,
  IRepositoryListItem,
  Repositoryish,
} from '../repositories-list/group-repositories'
import { RepositoryListItem } from '../repositories-list/repository-list-item'
import { Resizable } from '../resizable'

const CollapsedGroupsKey = 'repository-panel-collapsed-groups'
const NoMatches: IMatches = { title: [], subtitle: [] }

/**
 * Switching repositories remounts the repository view and this panel with it,
 * which shouldn't lose the user's place in the list.
 */
let lastScrollTop = 0
let shouldFocusSelection = false

interface IRepositoryPanelProps {
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly selectedRepository: Repositoryish
  readonly accounts: ReadonlyArray<Account>
  readonly repositoryGroups: ReadonlyArray<IRepositoryGroup>
  readonly repositorySSHAliases: ReadonlyMap<number, string>
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >
  readonly width: IConstrainedValue
  readonly isCollapsed: boolean
  readonly dispatcher: Dispatcher
  readonly onSelectionChanged: (repository: Repositoryish) => void
}

interface IRepositoryPanelState {
  readonly collapsedGroups: ReadonlySet<string>
}

/** A collapsible sidebar listing all repositories by their group. */
export class RepositoryPanel extends React.Component<
  IRepositoryPanelProps,
  IRepositoryPanelState
> {
  private readonly listRef = React.createRef<HTMLDivElement>()
  private readonly selectedRowRef = React.createRef<HTMLButtonElement>()

  private getGroups = memoizeOne(groupUserRepositories)

  public constructor(props: IRepositoryPanelProps) {
    super(props)
    this.state = {
      collapsedGroups: new Set(getStringArray(CollapsedGroupsKey)),
    }
  }

  public componentDidMount() {
    if (this.listRef.current !== null) {
      this.listRef.current.scrollTop = lastScrollTop
    }

    if (shouldFocusSelection) {
      shouldFocusSelection = false
      this.selectedRowRef.current?.focus()
    }
  }

  private onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    lastScrollTop = event.currentTarget.scrollTop
  }

  private onToggleGroup = (key: string) => {
    const collapsedGroups = new Set(this.state.collapsedGroups)
    if (!collapsedGroups.delete(key)) {
      collapsedGroups.add(key)
    }

    setStringArray(CollapsedGroupsKey, [...collapsedGroups])
    this.setState({ collapsedGroups })
  }

  private onSelectRepository = (repository: Repositoryish) => {
    if (repository.id !== this.props.selectedRepository.id) {
      shouldFocusSelection = true
      this.props.onSelectionChanged(repository)
    }
  }

  private onCollapse = () => {
    this.props.dispatcher.setRepositoryPanelCollapsed(true)
  }

  private onExpand = () => {
    this.props.dispatcher.setRepositoryPanelCollapsed(false)
  }

  private onResize = (width: number) => {
    this.props.dispatcher.setRepositoryPanelWidth(width)
  }

  private onReset = () => {
    this.props.dispatcher.resetRepositoryPanelWidth()
  }

  private renderRepository(item: IRepositoryListItem) {
    const { repository } = item
    const isSelected = repository.id === this.props.selectedRepository.id

    return (
      <button
        key={item.id}
        type="button"
        className={classNames('repository-panel-row', { selected: isSelected })}
        aria-current={isSelected ? 'true' : undefined}
        ref={isSelected ? this.selectedRowRef : undefined}
        // eslint-disable-next-line react/jsx-no-bind
        onClick={() => this.onSelectRepository(repository)}
      >
        <RepositoryListItem
          repository={repository}
          needsDisambiguation={item.needsDisambiguation}
          matches={NoMatches}
          aheadBehind={item.aheadBehind}
          changedFilesCount={item.changedFilesCount}
          accountLabel={item.accountLabel}
        />
      </button>
    )
  }

  private renderGroups() {
    const groups = this.getGroups(
      this.props.repositories,
      this.props.localRepositoryStateLookup,
      [],
      this.props.repositoryGroups,
      this.props.repositorySSHAliases,
      this.props.accounts
    )

    return groups.map(({ identifier, items }) => {
      const key = getGroupKey(identifier)
      const isExpanded = !this.state.collapsedGroups.has(key)

      return (
        <section key={key} className="repository-panel-group">
          <button
            type="button"
            className="repository-panel-group-header"
            aria-expanded={isExpanded}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => this.onToggleGroup(key)}
          >
            <Octicon
              symbol={isExpanded ? octicons.chevronDown : octicons.chevronRight}
            />
            <Octicon symbol={octicons.fileDirectory} />
            <span className="name">{getGroupLabel(identifier)}</span>
            <span className="count">{items.length}</span>
          </button>
          {isExpanded && items.map(item => this.renderRepository(item))}
        </section>
      )
    })
  }

  public render() {
    if (this.props.isCollapsed) {
      return (
        <div className="repository-panel collapsed">
          <Button
            className="repository-panel-toggle"
            onClick={this.onExpand}
            ariaLabel="Show repositories"
            ariaExpanded={false}
            tooltip="Show repositories"
          >
            <Octicon symbol={octicons.sidebarCollapse} />
          </Button>
        </div>
      )
    }

    const { width } = this.props

    return (
      <Resizable
        id="repository-panel"
        width={width.value}
        maximumWidth={width.max}
        minimumWidth={width.min}
        onReset={this.onReset}
        onResize={this.onResize}
        description="Repositories sidebar"
      >
        <div className="repository-panel">
          <header className="repository-panel-header">
            <span className="title">Repositories</span>
            <Button
              className="repository-panel-toggle"
              onClick={this.onCollapse}
              ariaLabel="Hide repositories"
              ariaExpanded={true}
              tooltip="Hide repositories"
            >
              <Octicon symbol={octicons.sidebarExpand} />
            </Button>
          </header>
          <div
            className="repository-list repository-panel-list"
            ref={this.listRef}
            onScroll={this.onScroll}
          >
            {this.renderGroups()}
          </div>
        </div>
      </Resizable>
    )
  }
}
