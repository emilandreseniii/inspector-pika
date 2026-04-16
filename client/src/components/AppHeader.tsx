import { useNavigate, useLocation } from 'react-router-dom'
import logo from '../assets/logo.svg'

export default function AppHeader() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const isJobs = pathname.startsWith('/jobs')
  const isSettings = pathname.startsWith('/settings')
  const activeSub = pathname.startsWith('/orgs') ? 'orgs'
    : pathname.startsWith('/packages') ? 'packages'
    : 'repos'

  return (
    <>
      <header style={styles.header}>
        <img src={logo} alt="Inspector Pika" style={styles.logo} />
        <span style={styles.title}>Inspector Pika</span>
        <nav style={styles.mainNav}>
          <button
            style={{ ...styles.mainTab, ...(!isJobs ? styles.mainTabActive : {}) }}
            onClick={() => navigate('/repos')}
          >
            Explore
          </button>
          <button
            style={{ ...styles.mainTab, ...(isJobs ? styles.mainTabActive : {}) }}
            onClick={() => navigate('/jobs')}
          >
            Jobs
          </button>
          <button
            style={{ ...styles.mainTab, ...(isSettings ? styles.mainTabActive : {}) }}
            onClick={() => navigate('/settings')}
          >
            Settings
          </button>
        </nav>
      </header>
      {!isJobs && !isSettings && (
        <nav style={styles.subNav}>
          <button
            style={{ ...styles.subTab, borderBottomColor: activeSub === 'orgs' ? '#fd8c73' : 'transparent', ...(activeSub === 'orgs' ? styles.subTabActiveText : {}) }}
            onClick={() => navigate('/orgs')}
          >
            Orgs
          </button>
          <button
            style={{ ...styles.subTab, borderBottomColor: activeSub === 'repos' ? '#fd8c73' : 'transparent', ...(activeSub === 'repos' ? styles.subTabActiveText : {}) }}
            onClick={() => navigate('/repos')}
          >
            Repos
          </button>
          <button
            style={{ ...styles.subTab, borderBottomColor: activeSub === 'packages' ? '#fd8c73' : 'transparent', ...(activeSub === 'packages' ? styles.subTabActiveText : {}) }}
            onClick={() => navigate('/packages')}
          >
            Packages
          </button>
        </nav>
      )}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    background: '#24292f',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    height: 56,
    gap: 12,
  },
  logo: {
    height: 36,
    width: 36,
    flexShrink: 0,
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    flexShrink: 0,
  },
  mainNav: {
    display: 'flex',
    marginLeft: 24,
    alignSelf: 'stretch',
    gap: 0,
  },
  mainTab: {
    padding: '0 16px',
    border: 'none',
    borderBottom: '3px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: 500,
    alignSelf: 'stretch',
    display: 'flex',
    alignItems: 'center',
  },
  mainTabActive: {
    color: '#fff',
    borderBottomColor: '#fd8c73',
    fontWeight: 600,
  },
  subNav: {
    background: '#fff',
    borderBottom: '1px solid #d0d7de',
    padding: '0 32px',
    display: 'flex',
    gap: 0,
  },
  subTab: {
    padding: '10px 16px',
    border: 'none',
    borderBottom: '3px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#57606a',
    fontWeight: 500,
    marginBottom: -1,
    textDecoration: 'none',
    outline: 'none',
  },
  subTabActiveText: {
    color: '#24292f',
    fontWeight: 600,
  },
}
