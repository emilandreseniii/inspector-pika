import { useNavigate } from 'react-router-dom'
import ExploreTab from '../components/ExploreTab'
import JobsTab from '../components/JobsTab'
import logo from '../assets/logo.svg'

interface Props {
  tab: 'explore' | 'jobs'
}

export default function MainPage({ tab }: Props) {
  const navigate = useNavigate()

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <img src={logo} alt="Inspector Pika" style={styles.logo} />
        <h1 style={styles.title}>Inspector Pika</h1>
      </header>

      <nav style={styles.tabBar}>
        <button
          style={{ ...styles.tab, ...(tab === 'explore' ? styles.activeTab : {}) }}
          onClick={() => navigate('/')}
        >
          Explore
        </button>
        <button
          style={{ ...styles.tab, ...(tab === 'jobs' ? styles.activeTab : {}) }}
          onClick={() => navigate('/jobs')}
        >
          Jobs
        </button>
      </nav>

      <main style={styles.content}>
        {tab === 'explore' ? <ExploreTab /> : <JobsTab />}
      </main>
    </div>
  )
}

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    minHeight: '100vh',
    background: '#f6f8fa',
  } as React.CSSProperties,
  header: {
    background: '#24292f',
    padding: '0 32px',
    display: 'flex',
    alignItems: 'center',
    height: 56,
  } as React.CSSProperties,
  logo: {
    height: 54,
    width: 54,
    marginRight: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  } as React.CSSProperties,
  tabBar: {
    background: '#fff',
    borderBottom: '1px solid #d0d7de',
    padding: '0 32px',
    display: 'flex',
    gap: 0,
  } as React.CSSProperties,
  tab: {
    padding: '12px 16px',
    border: 'none',
    borderBottom: '3px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#57606a',
    fontWeight: 500,
    marginBottom: -1,
  } as React.CSSProperties,
  activeTab: {
    color: '#24292f',
    borderBottomColor: '#fd8c73',
    fontWeight: 600,
  } as React.CSSProperties,
  content: {
    padding: 32,
    maxWidth: 1100,
    margin: '0 auto',
  } as React.CSSProperties,
}
