import { lazy, Suspense } from "react";
import { useAppContext } from "../data";
import { TopToolbar } from "./TopToolbar";

const ChatBody = lazy(() =>
  import("./ChatBody").then(m => ({ default: m.ChatBody }))
);
const DocBody = lazy(() =>
  import("./DocBody").then(m => ({ default: m.DocBody }))
);

function ViewFallback() {
  return <div className="flex-1 min-w-0 min-h-0" aria-hidden />;
}

export function MainContent() {
  const { activeView } = useAppContext();

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
      {activeView === "doc" && <TopToolbar />}
      <Suspense fallback={<ViewFallback />}>
        {activeView === "chat" ? <ChatBody /> : <DocBody />}
      </Suspense>
    </div>
  );
}
