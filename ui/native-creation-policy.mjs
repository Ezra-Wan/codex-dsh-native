// The shipped sidebar has no separate slot for its creation buttons. Use its
// own locale vocabulary and semantic accessible names, never hashed classes.
// This hides UI affordances only; ownership/permission enforcement is separate.
const cssString = value => `"${String(value).replace(/[\x00-\x1f\x7f]/g, ' ').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
export function nativeCreationPolicyCss(locale) {
  const sidebar = locale.bind('sidebar'), workspace = locale.bind('workspace');
  const names = [sidebar('session.new.label'), workspace('workspace.add'), locale.bind('schedule.manager')('panel')];
  const selectors = names.map(label => `#root button[aria-label=${cssString(label)}]`);
  const marker = '__CODEX_WORKSPACE_LABEL__';
  const pattern = workspace('actions.newSession.aria', { name: marker });
  if (pattern.includes(marker)) {
    const [prefix, suffix] = pattern.split(marker);
    const constraints = (prefix ? `[aria-label^=${cssString(prefix)}]` : '') + (suffix ? `[aria-label$=${cssString(suffix)}]` : '');
    if (constraints) selectors.push(`#root button${constraints}`);
  }
  return `${selectors.join(',\n')} { display: none !important; }`;
}
