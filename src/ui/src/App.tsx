import { useSquash } from "./hooks/useSquash";
import { IssueList } from "./components/IssueList";
import { IssueDetail } from "./components/IssueDetail";

export default function App() {
  const { issues, logs, selectedId, setSelectedId, addIssue, removeIssue, retryIssue, markComplete, lookupRepo, registerRepo } = useSquash();
  const selectedIssue = selectedId ? issues[selectedId] ?? null : null;
  const selectedLogs = selectedId ? logs[selectedId] ?? [] : [];

  return (
    <div className="h-screen flex bg-white">
      <IssueList
        issues={issues}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={async (url, context, repoId) => { await addIssue(url, context, repoId); }}
        onLookupRepo={lookupRepo}
        onRegisterRepo={registerRepo}
        onDelete={async (id) => { await removeIssue(id); }}
        onRetry={async (id) => { await retryIssue(id); }}
        onComplete={async (id) => { await markComplete(id); }}
      />
      <IssueDetail issue={selectedIssue} logs={selectedLogs} />
    </div>
  );
}
