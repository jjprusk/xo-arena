import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import PlayPage from './pages/PlayPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import LogViewerPage from './pages/LogViewerPage.jsx'
import AIDashboardPage from './pages/AIDashboardPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import MLDashboardPage from './pages/MLDashboardPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/play" replace />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/admin/logs" element={<LogViewerPage />} />
          <Route path="/admin/ai" element={<AIDashboardPage />} />
          <Route path="/admin/ml" element={<MLDashboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
