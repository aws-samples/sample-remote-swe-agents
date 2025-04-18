import { reportProgressTool } from '../tools/report-progress';

export const renderToolResult = (props: { toolResult: string; forceReport: boolean }) => {
  return `
<result>
${props.toolResult}
</result>
<command>
${props.forceReport ? `Long time has passed since you sent the last message. Please use ${reportProgressTool.name} tool to send a response asap.` : ''}
</command>
`.trim();
};

export const renderUserMessage = (props: { message: string }) => {
  return `
<user_message>
${props.message}
</user_message>
<command>
User sent you a message. Please use ${reportProgressTool.name} tool to send a response asap.
</command>
`.trim();
};
