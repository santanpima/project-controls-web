import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@shared/auth/AuthContext";
import { RequireAuth } from "@shared/auth/RequireAuth";
import { LoginPage } from "@features/auth/LoginPage";
import { RegisterPage } from "@features/auth/RegisterPage";
import { HomePage } from "./HomePage";

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<HomePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
