export function ActivityChanges({ changes }: { changes?: string }) {
  if (!changes) return null;
  let details = changes;
  try {
    details = JSON.stringify(JSON.parse(changes), null, 2);
  } catch {
    // Older events may contain plain text instead of JSON.
  }
  return (
    <details className="activity-changes">
      <summary>عرض التفاصيل التقنية</summary>
      <pre dir="auto">{details}</pre>
    </details>
  );
}
