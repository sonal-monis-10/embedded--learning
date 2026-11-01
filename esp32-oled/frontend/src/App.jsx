import { Route, Routes } from 'react-router';
import DevicePage from './pages/DevicePage.jsx';
import HomePage from './pages/HomePage.jsx';
import PairPage from './pages/PairPage.jsx';

export default function App() {
  return (
    <main className="app">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/pair" element={<PairPage />} />
        <Route path="/pair/:code" element={<PairPage />} />
        <Route path="/devices/:id" element={<DevicePage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </main>
  );
}
