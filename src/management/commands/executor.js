export function executeCommand({ command, args, policy, helpItems }) {
  if (!command) return { type: 'unknown', text: '发送 /help 查看可用命令。' }
  if (command.builtin === 'help') {
    const lines = helpItems.map((item) => `${item.name} - ${item.description}`)
    return { type: 'text', text: `可用命令：\n${lines.join('\n')}` }
  }
  if (command.builtin === 'reset') return { type: 'reset' }
  if (command.builtin === 'newchat') return { type: 'newchat' }
  if (command.builtin === 'refresh-relations') return { type: 'refresh-relations' }
  const authorized = command.capabilities.every((capability) => policy.authorize({ capability }).allowed)
  if (!authorized) return { type: 'denied', text: '你没有权限执行该命令。' }
  if (command.executionType === 'static') {
    return { type: 'text', text: command.steps?.[0]?.text || '' }
  }
  if (command.executionType === 'model_task') {
    return { type: 'model_task', template: command.steps?.[0]?.template || '', args: args.join(' ') }
  }
  if (command.executionType === 'workflow') {
    if (command.steps.length > 5) return { type: 'denied', text: '工作流步骤不能超过 5 步。' }
    return { type: 'workflow', steps: command.steps }
  }
  return { type: 'unknown', text: '无法执行该命令。' }
}
