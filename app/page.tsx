import { requireActor } from "./lib/server-auth";
import LvAssistant from "./lv-assistant";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await requireActor();
  return <LvAssistant displayName={actor.displayName} />;
}
