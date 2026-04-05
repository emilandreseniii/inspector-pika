import AppHeader from '../components/AppHeader'
import ExploreTab from '../components/ExploreTab'
import JobsTab from '../components/JobsTab'
import OrgsTab from '../components/OrgsTab'
import PackagesTab from '../components/PackagesTab'

type SubTab = 'repos' | 'orgs' | 'packages'

interface Props {
  tab: 'explore' | 'jobs'
  subTab?: SubTab
}

export default function MainPage({ tab, subTab = 'repos' }: Props) {
  return (
    <div style={styles.container}>
      <AppHeader />
      <main style={styles.content}>
        {tab === 'jobs' && <JobsTab />}
        {tab === 'explore' && subTab === 'repos' && <ExploreTab />}
        {tab === 'explore' && subTab === 'orgs' && <OrgsTab />}
        {tab === 'explore' && subTab === 'packages' && <PackagesTab />}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    minHeight: '100vh',
    background: '#f6f8fa',
  },
  content: {
    padding: 32,
    maxWidth: 1100,
    margin: '0 auto',
  },
}
