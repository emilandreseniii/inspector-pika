import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import MainPage from './pages/MainPage'
import RepositoryPage from './pages/RepositoryPage'
import JobDetailPage from './pages/JobDetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainPage tab="explore" />} />
        <Route path="/jobs" element={<MainPage tab="jobs" />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/repositories/:id" element={<RepositoryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
