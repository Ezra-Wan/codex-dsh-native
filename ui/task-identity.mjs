export function taskIdentity(task) {
  const role = task.role === 'sub' ? '子 agent〔sub〕'
    : task.role === 'peer' ? '协作 agent〔peer〕' : '角色未标注';
  const name = task.name || task.agent_id?.slice(0, 8) || 'DSH';
  return `${role} · ${name}${task.backend === 'worker' ? ' · 旧 worker 兜底' : ''}`;
}
