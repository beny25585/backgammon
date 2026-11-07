import { useCallback, useLayoutEffect, useState } from "react";
import { useGameBuildUpdate } from "./useGameBuildUpdate";

export function GameBuildUpdateHarness({
  pathname,
  currentVersion,
  browserPathname = pathname,
}: {
  pathname: string;
  currentVersion: string;
  browserPathname?: string;
}) {
  const [reloads, setReloads] = useState(0);
  const recordReload = useCallback(() => setReloads((count) => count + 1), []);

  useLayoutEffect(() => {
    window.history.replaceState(null, "", `${import.meta.env.BASE_URL}${browserPathname.slice(1)}`);
  }, [browserPathname]);

  useGameBuildUpdate(pathname, currentVersion, recordReload);

  return <output data-testid="build-reloads">{reloads}</output>;
}
