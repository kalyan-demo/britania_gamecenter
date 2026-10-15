import { useEffect, useState } from "react";
import { fw } from "@fireweaveai/web-sdk/start";

/** Re-renders when FireWeave decisions arrive or the signed-in user changes. */
export function useChessEnabled() {
  const [, bump] = useState(0);
  useEffect(() => fw.subscribe(() => bump((n) => n + 1)), []);
  // @fireweave-controlpoint chess
  return fw.controlPoints.getBooleanValue("chess", false);
}
