import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import SupportRoute from './components/admin/SupportRoute.jsx'
import PlayPage from './pages/PlayPage.jsx'
import StatsPage from './pages/StatsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import GymPage from './pages/MLDashboardPage.jsx'
import GymGuidePage from './pages/GymGuidePage.jsx'
import PuzzlePage from './pages/PuzzlePage.jsx'
import SupportPage from './pages/SupportPage.jsx'
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
          <Route path="/gym" element={<GymPage />} />
          <Route path="/gym/guide" element={<GymGuidePage />} />

          {/* Support route — accessible to admin and SUPPORT role users */}
          <Route path="/support" element={<SupportRoute><SupportPage /></SupportRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
