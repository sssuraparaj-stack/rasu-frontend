import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SlideEditor from './pages/SlideEditor';
import SessionHistory from './pages/SessionHistory';
import HostSession from './pages/HostSession';
import JoinSession from './pages/JoinSession';
import StudentSession from './pages/StudentSession';
import './styles.css';

export const API = 'https://rasu-quizz-production-0e45.up.railway.app/api/v1';
export const WS  = 'https://rasu-quizz-production-0e45.up.railway.app';

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/join"     element={<JoinSession />} />
        <Route path="/play/:sessionId" element={<StudentSession />} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/editor/:presentationId" element={<PrivateRoute><SlideEditor /></PrivateRoute>} />
        <Route path="/history" element={<PrivateRoute><SessionHistory /></PrivateRoute>} />
        <Route path="/host/:sessionId" element={<PrivateRoute><HostSession /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}
