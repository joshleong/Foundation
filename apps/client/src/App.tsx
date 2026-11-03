import { useEffect, useState } from "react";
import type { UserInfo } from "@foundation/protocol";
import { initNight } from "@foundation/ui";
import "@foundation/ui/tokens.css";
import { Login } from "./login/Login";
import { Shell } from "./shell/Shell";
import { DesignPage } from "./design/DesignPage";
import { Tip } from "./shell/Tip";
import { rememberMe, whoAmI } from "./lib/api";
import "./App.css";
import "./shell/shell.css";
import "./panels/live.css";

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
    void whoAmI().then((r) => setUser(r.user));
  }, []);

  return (
    <>
      {route.startsWith("#/design/sign-in") ? (
        <Login
          onSignedIn={(u) => {
            // signing in from the preview goes in
            rememberMe(u);
            setUser(u);
            window.location.hash = "";
          }}
        />
      ) : route.startsWith("#/design") ? (
        <DesignPage />
      ) : user === undefined ? (
        <div className="boot" />
      ) : !user ? (
        <Login
          onSignedIn={(u) => {
            rememberMe(u);
            setUser(u);
          }}
        />
      ) : (
        <Shell user={user} />
      )}
      <Tip />
    </>
  );
}

export default App;
