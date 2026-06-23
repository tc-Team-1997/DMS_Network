import { createBrowserRouter, Navigate } from "react-router-dom";
import { Login } from "./pages/Login.js";
import { Users } from "./pages/Users.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/users", element: <ProtectedRoute permission="user:read"><Users /></ProtectedRoute> },
  { path: "*", element: <Navigate to="/users" replace /> },
]);
