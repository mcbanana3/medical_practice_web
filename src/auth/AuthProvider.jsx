import { createContext, useCallback, useContext, useEffect, useState, useRef } from "react";
import { post, session } from "./client.js";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true, patient: null, error: ""
  });

  const revision = useRef(0);
  const refresh = useCallback(async (force = false) => {
    const current = ++revision.current;
    try {
      const result = await session(force === true);
      if (current !== revision.current) return null;
      setState({ ...result, loading: false, error: "" });
      return result;
    } catch {
      if (current !== revision.current) return null;
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
    revision.current += 1;
    await post("/api/auth/logout");
    setState({ loading: false, patient: null, error: "" });
    await refresh(true);
  }

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);