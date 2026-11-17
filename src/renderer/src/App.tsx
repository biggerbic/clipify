import { Component, type ReactNode } from 'react'
import { AppFrame } from './components/AppFrame'
import { useStore } from './lib/store'
import { Home } from './screens/Home'
import { Dashboard } from './screens/Dashboard'
import { Library } from './screens/Library'
import { Projects } from './screens/Projects'
import { ProjectScreen } from './screens/Project'
import { Schedule } from './screens/Schedule'
import { SettingsScreen } from './screens/Settings'
import { Button } from './ui'

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }): { error: null; key: string } | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-10">
        <div className="panel max-w-lg rounded-[24px] p-6">
          <h2 className="font-display text-xl">Something went wrong on this screen</h2>
          <p className="mt-2 text-text-3">{this.state.error.message}</p>
          <Button className="mt-4" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
}

export function App() {
  const route = useStore((s) => s.route)
  const key = JSON.stringify(route)
  let screen: ReactNode
  switch (route.name) {
    case 'home':
      screen = <Home />
      break
    case 'dashboard':
      screen = <Dashboard accountId={route.accountId} />
      break
    case 'library':
      screen = <Library />
      break
    case 'projects':
      screen = <Projects />
      break
    case 'project':
      screen = <ProjectScreen id={route.id} step={route.step} variantId={route.variantId} />
      break
    case 'schedule':
      screen = <Schedule />
      break
    case 'settings':
      screen = <SettingsScreen section={route.section} />
      break
  }
  return (
    <AppFrame>
      <Boundary resetKey={key}>{screen}</Boundary>
    </AppFrame>
  )
}
