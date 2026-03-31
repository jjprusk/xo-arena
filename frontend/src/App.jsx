import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import AdminRoute from './components/admin/AdminRoute.jsx'
import PlayPage from './pages/PlayPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import LogViewerPage from './pages/LogViewerPage.jsx'
import AIDashboardPage from './pages/AIDashboardPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import GymPage from './pages/MLDashboardPage.jsx'
import GymGuidePage from './pages/GymGuidePage.jsx'
import PuzzlePage from './pages/PuzzlePage.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx'
import AdminGamesPage from './pages/admin/AdminGamesPage.jsx'
import AdminMLPage from './pages/admin/AdminMLPage.jsx'
import AdminBotsPage from './pages/admin/AdminBotsPage.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'
import BotProfilePage from './pages/BotProfilePage.jsx'
import AboutPage from './pages/AboutPage.jsx'
import FAQPage from './pages/FAQPage.jsx'

const isStaging = import.meta.env.VITE_ENV === 'staging'

export default function App() {
  useEffect(() => {
    if (isStaging) document.title = '[STAGING] XO Arena'
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/play" replace />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/puzzles" element={<PuzzlePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/bots/:id" element={<BotProfilePage />} />
          <Route path="/ml" element={<GymPage />} />
          <Route path="/gym/guide" element={<GymGuidePage />} />

          {/* Admin routes — all guarded by AdminRoute */}
          <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
          <Route path="/admin/games" element={<AdminRoute><AdminGamesPage /></AdminRoute>} />
          <Route path="/admin/logs" element={<AdminRoute><LogViewerPage /></AdminRoute>} />
          <Route path="/admin/ai" element={<AdminRoute><AIDashboardPage /></AdminRoute>} />
          <Route path="/admin/ml-models" element={<AdminRoute><AdminMLPage /></AdminRoute>} />
          <Route path="/admin/bots" element={<AdminRoute><AdminBotsPage /></AdminRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
