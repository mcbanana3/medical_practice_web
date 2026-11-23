import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { post, session } from "./client.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true, patient: null, error: ""
  });

  const refresh = useCallback(async () => {
    try {
      const result = await session();
      setState({ ...result, loading: false, error: "" });
      return result;
    } catch {
      setState({
        loading: false,
        patient: null,
        error: "Account services are unavailable. No private information is shown."
      });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("patient-session-invalid", focus);

    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("patient-session-invalid", focus);
    };
  }, [refresh]);

  async function logout() {
    await post("/api/auth/logout");
    setState({ loading: false, patient: null, error: "" });
    await refresh();
  }

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);