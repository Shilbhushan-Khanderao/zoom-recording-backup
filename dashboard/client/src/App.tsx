import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Backups from './pages/Backups'
import System from './pages/System'
import Logs from './pages/Logs'
import Alerts from './pages/Alerts'
import Explorer from './pages/Explorer'
import Auth from './pages/Auth'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/backups" element={<Backups />} />
        <Route path="/system" element={<System />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/auth" element={<Auth />} />
      </Routes>
    </Layout>
  )
}

export default App
