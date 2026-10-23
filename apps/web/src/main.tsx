import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import AccountPage from './AccountPage';
import AdminLayout from './AdminLayout';
import AdminMoviesPage from './AdminMoviesPage';
import AdminShowtimesPage from './AdminShowtimesPage';
import AppLayout from './AppLayout';
import { appBasePath } from './app-base';
import { AuthSessionProvider } from './AuthSessionProvider';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import SignInPage from './SignInPage';
import SignUpPage from './SignUpPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={appBasePath}>
      <AuthSessionProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<App />} />
            <Route path="/inscription" element={<SignUpPage />} />
            <Route path="/connexion" element={<SignInPage />} />
            <Route path="/mon-espace" element={<AccountPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate replace to="seances" />} />
              <Route path="seances" element={<AdminShowtimesPage />} />
              <Route path="films" element={<AdminMoviesPage />} />
            </Route>
            <Route
              path="/mot-de-passe-oublie"
              element={<ForgotPasswordPage />}
            />
            <Route
              path="/reinitialiser-mot-de-passe"
              element={<ResetPasswordPage />}
            />
          </Route>
        </Routes>
      </AuthSessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
