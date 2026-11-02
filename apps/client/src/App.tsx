import { useEffect, useState } from "react";
import type { UserInfo } from "@foundation/protocol";
import { initNight } from "@foundation/ui";
import "@foundation/ui/tokens.css";
import { Login } from "./login/Login";
import { Shell } from "./shell/Shell";
import { DesignPage } from "./design/DesignPage";
import { me } from "./lib/api";
import "./App.css";
import "./shell/shell.css";

initNight();

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

/**
 * Sign-in gate → the shell. #/design is the living design language page;
 * #/design/sign-in shows the sign-in page even when signed in.
 */
function App() {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined);
  const route = useHashRoute();

  useEffect(() => {
    me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (route.startsWith("#/design/sign-in")) return <Login onSignedIn={setUser} />;
  if (route.startsWith("#/design")) return <DesignPage />;
  if (user === undefined) return <div className="boot" />;
  if (!user) return <Login onSignedIn={setUser} />;
  return <Shell user={user} />;
}

export default App;
