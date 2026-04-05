import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MainPage from './pages/MainPage'
import RepositoryPage from './pages/RepositoryPage'
import JobDetailPage from './pages/JobDetailPage'
import OrgPage from './pages/OrgPage'
import PackagePage from './pages/PackagePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/repos" replace />} />
        <Route path="/repos" element={<MainPage tab="explore" subTab="repos" />} />
        <Route path="/orgs" element={<MainPage tab="explore" subTab="orgs" />} />
        <Route path="/orgs/:owner" element={<OrgPage />} />
        <Route path="/packages" element={<MainPage tab="explore" subTab="packages" />} />
        <Route path="/packages/:id" element={<PackagePage />} />
        <Route path="/jobs" element={<MainPage tab="jobs" />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/repositories/:id" element={<RepositoryPage />} />
        <Route path="*" element={<Navigate to="/repos" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
