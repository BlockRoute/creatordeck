/** Word-level diff good enough for titles and descriptions: common prefix and suffix, changed middle. */
export function Diff({ before, after }: { before: string; after: string }) {
  if (before === after) return <span className="pre">{after}</span>;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }
  const context = 60;
  const head = before.slice(Math.max(0, start - context), start);
  const tail = before.slice(endB, endB + context);
  return (
    <span className="diff pre">
      {start > context ? '…' : ''}
      {head}
      {endB > start ? <del>{before.slice(start, endB)}</del> : null}
      {endA > start ? <ins>{after.slice(start, endA)}</ins> : null}
      {tail}
      {before.length - endB > context ? '…' : ''}
    </span>
  );
}

export function TagDiff({ before, after }: { before: string[]; after: string[] }) {
  const removed = before.filter((t) => !after.includes(t));
  const added = after.filter((t) => !before.includes(t));
  if (!removed.length && !added.length) return <span className="muted">order changed</span>;
  return (
    <span className="diff">
      {removed.map((t) => (
        <del key={`r-${t}`} style={{ marginRight: 6 }}>
          {t}
        </del>
      ))}
      {added.map((t) => (
        <ins key={`a-${t}`} style={{ marginRight: 6 }}>
          {t}
        </ins>
      ))}
    </span>
  );
}
