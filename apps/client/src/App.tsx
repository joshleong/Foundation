import { useEffect, useState } from "react";
import type { UserInfo } from "@foundation/protocol";
import { initNight } from "@foundation/ui";
import "@foundation/ui/tokens.css";
import { Login } from "./login/Login";
import { Shell } from "./shell/Shell";
import { DesignPage } from "./design/DesignPage";
import { Tip } from "./shell/Tip";
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

  return (
    <>
      {route.startsWith("#/design/sign-in") ? (
        <Login onSignedIn={setUser} />
      ) : route.startsWith("#/design") ? (
        <DesignPage />
      ) : user === undefined ? (
        <div className="boot" />
      ) : !user ? (
        <Login onSignedIn={setUser} />
      ) : (
        <Shell user={user} />
      )}
      <Tip />
    </>
  );
}

export default App;
