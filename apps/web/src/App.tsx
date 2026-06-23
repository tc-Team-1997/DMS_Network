import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { router } from "./router.js";

export function App() {
  return <AuthProvider><RouterProvider router={router} /></AuthProvider>;
}
