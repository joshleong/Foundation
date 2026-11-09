import { useEffect, useState } from "react";
import type { UserInfo } from "@foundation/protocol";
import { initNight } from "@foundation/ui";
import "@foundation/ui/tokens.css";
import { Login } from "./login/Login";
import { Shell } from "./shell/Shell";
import { DesignPage } from "./design/DesignPage";
import { SettingsPage } from "./settings/SettingsPage";
import { Tip } from "./shell/Tip";
import { rememberMe, whoAmI } from "./lib/api";
import { UpdateShelf } from "./update/UpdateCard";
import { startUpdates } from "./update/updater";
import "./App.css";
import "./shell/shell.css";
import "./panels/live.css";
import "./shell/crew.css";
import "./settings/settings.css";

initNight();
// the desktop app asks its signed feed for a new version a few seconds after it opens (inert in a browser)
startUpdates();

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
 * #/design/sign-in shows the sign-in page even when signed in. #/settings
 * (signed in) holds the plan board and what the server is connected to.
 *
 * The sign-in page stays over the shell until its dissolve has run, so
 * signing in turns into the board rather than cutting to it. Back from
 * flowform's Google sign-in in the browser (?arrive), it dissolves on arrival.
 */
function App() {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined);
  const route = useHashRoute();
  const [arrive] = useState(() => new URLSearchParams(window.location.search).has("arrive"));
  /** the sign-in page is still dissolving over the shell */
  const [veil, setVeil] = useState(arrive);

  useEffect(() => {
    void whoAmI().then((r) => setUser(r.user));
    if (arrive) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, [arrive]);

  const preview = route.startsWith("#/design/sign-in");
  if (route.startsWith("#/design") && !preview) {
    return (
      <>
        <DesignPage />
        <Tip />
      </>
    );
  }
  if (user === undefined && !preview) return <div className="boot" />;
  if (user && route.startsWith("#/settings")) {
    return (
      <>
        <SettingsPage route={route} />
        <UpdateShelf />
        <Tip />
      </>
    );
  }
  return (
    <>
      {user && <Shell user={user} />}
      {(preview || !user || veil) && (
        <Login
          arriving={veil && arrive && !!user}
          onSignedIn={(u) => {
            rememberMe(u);
            setUser(u);
            setVeil(true);
          }}
          onGone={() => {
            setVeil(false);
            // signing in from the preview goes in
            if (preview) window.location.hash = "";
          }}
        />
      )}
      {/* over the sign-in page (always day), the card wears day too */}
      <UpdateShelf day={preview || !user || veil} />
      <Tip />
    </>
  );
}

export default App;
