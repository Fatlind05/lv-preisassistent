import { getChatGPTUser } from "./chatgpt-auth";
import LvAssistant from "./lv-assistant";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <LvAssistant displayName={user?.displayName ?? null} />;
}
