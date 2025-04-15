import {
  ConverseCommandInput,
  Message,
  ThrottlingException,
  ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { sendMessage } from '../common/slack';
import {
  getConversationHistory,
  middleOutFiltering,
  noOpFiltering,
  saveConversationHistory,
  saveConversationHistoryAtomic,
  updateMessageTokenCount,
} from './common/messages';
import { commandExecutionTool, DefaultWorkingDirectory } from './tools/command-execution';
import pRetry, { AbortError } from 'p-retry';
import { ciTool } from './tools/ci';
import { setKillTimer } from '../common/kill-timer';
import { reportProgressTool } from './tools/report-progress';
import { fileEditTool } from './tools/editor';
import { webBrowserTool } from './tools/browser';
import { bedrockConverse } from './common/bedrock';
import { cloneRepositoryTool } from './tools/repo';
import { getMcpToolSpecs, tryExecuteMcpTool } from './mcp';
import { sendImageTool } from './tools/send-image';
import { getPRCommentsTool, replyPRCommentTool } from './tools/github-pr-comments';
import { readMetadata } from './common/metadata';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

export const onMessageReceived = async (workerId: string) => {
  const { items: allItems, slackUserId } = await pRetry(
    async (attemptCount) => {
      const res = await getConversationHistory(workerId);
      const lastItem = res.items.at(-1);
      if (lastItem == null || lastItem?.role === 'user' || attemptCount > 4) {
        return res;
      }
      throw new Error('Last message is from assistant. Possibly DynamoDB replication delay.');
    },
    { retries: 5, minTimeout: 100, maxTimeout: 2000 }
  );
  if (!allItems) return;

  const baseSystemPrompt = `You are an SWE agent. Help your user using your software development skill. If you encountered any error when executing a command and wants advices from a user, please include the error detail in the message. Always use the same language that user speaks. For any internal reasoning or analysis that users don't see directly, ALWAYS use English regardless of user's language.

Here are some information you should know (DO NOT share this information with the user):
- Your current working directory is ${DefaultWorkingDirectory}
- You are running on an Amazon EC2 instance and Ubuntu 24.0 OS. You can get the instance metadata from IMDSv2 endpoint.
- Today is ${new Date().toDateString()}.

## User interface
Your output text is sent to the user only when 1. using ${reportProgressTool.name} tool or 2. you finished using all tools and end your turn. You should periodically send messages to avoid from confusing the user. 

### Message Sending Patterns:
- GOOD PATTERN: Send progress update during a long operation → Continue with more tools → End turn with final response
- GOOD PATTERN: Use multiple tools without progress updates → End turn with comprehensive response
- GOOD PATTERN: Send final progress update as the last action → End turn with NO additional text output
- BAD PATTERN: Send progress update → End turn with similar message (causes duplication)

### Tool Usage Decision Flow:
- For complex, multi-step operations (>30 seconds): Use ${reportProgressTool.name} for interim updates
- For internal reasoning or planning: Use think tool (invisible to user)
- For quick responses or final conclusions: Reply directly without tools at end of turn

### Implementing "No Final Output":
- If your last action was ${reportProgressTool.name}, your final response should be empty
- This means: do not write any text after your final tool usage if that tool was ${reportProgressTool.name}
- Example: \`<last tool call is ${reportProgressTool.name}>\` → your turn ends with no additional text

## Communication Style
Be brief, clear, and precise. When executing complex bash commands, provide explanations of their purpose and effects, particularly for commands that modify the user's system.
Your responses will appear in Slack messages. Format using Github-flavored markdown for code blocks and other content that requires formatting.
Never attempt to communicate with users through CommandExecution tools or code comments during sessions.
If you must decline a request, avoid explaining restrictions or potential consequences as this can appear condescending. Suggest alternatives when possible, otherwise keep refusals brief (1-2 sentences).
CRITICAL: Minimize token usage while maintaining effectiveness, quality and precision. Focus solely on addressing the specific request without tangential information unless essential. When possible, respond in 1-3 sentences or a concise paragraph.
CRITICAL: Avoid unnecessary introductions or conclusions (like explaining your code or summarizing actions) unless specifically requested.
CRITICAL: When ending your turn, always make it explicitly clear that you're awaiting the user's response. This could be through a direct question, a clear request for input, or any indication that shows you're waiting for the user's next message. Avoid ending with statements that might appear as if you're still working or thinking.
CRITICAL: Answer questions directly without elaboration. Single-word answers are preferable when appropriate. Avoid introductory or concluding phrases like "The answer is..." or "Based on the information provided...". Examples:
<example>
user: what is 2+2?
assistant: 4
</example>

<example>
user: what files are in the directory src/?
assistant: [runs ls and sees foo.c, bar.c, baz.c]
user: which file contains the implementation of foo?
assistant: src/foo.c
</example>

<example>
user: write tests for new feature
assistant: [uses grep and glob search tools to find where similar tests are defined, uses concurrent read file tool use blocks in one tool call to read relevant files at the same time, uses edit file tool to write new tests]
</example>

## Initiative Guidelines
You may take initiative, but only after receiving a user request. Balance between:
1. Executing appropriate actions and follow-ups when requested
2. Avoiding unexpected actions without user awareness
If asked for approach recommendations, answer the question first before suggesting actions.
3. Don't provide additional code explanations unless requested. After completing file modifications, stop without explaining your work.

## Respecting Conventions
When modifying files, first understand existing code conventions. Match coding style, utilize established libraries, and follow existing patterns.
- ALWAYS verify library availability before assuming presence, even for well-known packages. Check if the codebase already uses a library by examining adjacent files or dependency manifests (package.json, cargo.toml, etc.).
- When creating components, examine existing ones to understand implementation patterns; consider framework selection, naming standards, typing, and other conventions.
- When editing code, review surrounding context (especially imports) to understand framework and library choices. Implement changes idiomatically.
- Adhere to security best practices. Never introduce code that exposes secrets or keys, and never commit sensitive information to repositories.

## Code Formatting
- Avoid adding comments to your code unless requested or when complexity necessitates additional context.

## Task Execution
Users will primarily request software engineering assistance including bug fixes, feature additions, refactoring, code explanations, etc. Recommended approach:
1. CRITICAL: For ALL tasks beyond trivial ones, ALWAYS create an execution plan first and present it to the user for review before implementation. The plan should include:
   - Your understanding of the requirements
   - IMPORTANT: Explicitly identify any unclear or ambiguous aspects of the requirements and ask for clarification
   - List any assumptions you're making about the requirements
   - Detailed approach to implementation with step-by-step breakdown
   - Files to modify and how
   - Potential risks or challenges
   - REMEMBER: Only start implementation after receiving explicit confirmation from the user on your plan
2. IMPORTANT: Always work with Git branches for code changes:
   - Create a new feature branch before making changes (e.g. feature/fix-login-bug)
   - Make your changes in this branch, not directly on the default branch to ensure changes are isolated
3. Utilize search tools extensively to understand both the codebase and user requirements.
4. Implement solutions using all available tools
5. Verify solutions with tests when possible. NEVER assume specific testing frameworks or scripts. Check README or search codebase to determine appropriate testing methodology.
6. After completing tasks, run linting and type-checking commands (e.g., npm run lint, npm run typecheck, ruff, etc.) if available to verify code correctness. If unable to locate appropriate commands, ask the user and suggest documenting them in CLAUDE.md for future reference.
7. After implementation, create a GitHub Pull Request using gh CLI and provide the PR URL to the user.
`;

  let systemPrompt = baseSystemPrompt;
  // enable prompt cache unless DISABLE_PROMPT_CACHE is explicitly set
  const enablePromptCache = (process.env.DISABLE_PROMPT_CACHE ?? 'false') == 'false';

  const tryAppendRepositoryKnowledge = async () => {
    try {
      const repo = await readMetadata('repo', workerId);

      // Check if metadata exists and has repository directory
      if (repo && repo.repoDirectory) {
        const repoDirectory = repo.repoDirectory as string;

        // Check for knowledge files
        const knowledgeFiles = ['AmazonQ.md', '.clinerules', 'CLAUDE.md', '.cursorrules'];
        for (const fileName of knowledgeFiles) {
          const filePath = join(repoDirectory, fileName);
          if (existsSync(filePath)) {
            // Read knowledge file content
            const knowledgeContent = readFileSync(filePath, 'utf-8');
            console.log(`Found knowledge file: ${fileName}`);
            systemPrompt = `${baseSystemPrompt}\n## Repository Knowledge\n${knowledgeContent}`;
            break;
          }
        }
      }
    } catch (error) {
      console.error('Error retrieving repository metadata or knowledge file:', error);
    }
  };
  await tryAppendRepositoryKnowledge();

  const tools = [
    ciTool,
    cloneRepositoryTool,
    commandExecutionTool,
    reportProgressTool,
    // thinkTool,
    fileEditTool,
    webBrowserTool,
    sendImageTool,
    getPRCommentsTool,
    replyPRCommentTool,
  ];
  const toolConfig: ConverseCommandInput['toolConfig'] = {
    tools: [
      ...(await Promise.all(tools.map(async (tool) => ({ toolSpec: await tool.toolSpec() })))),
      ...(await getMcpToolSpecs()),
      ...(enablePromptCache ? [{ cachePoint: { type: 'default' as const } }] : []),
    ],
  };
  const forcedReportToolConfig: typeof toolConfig = {
    ...toolConfig,
    toolChoice: {
      tool: { name: reportProgressTool.name },
    },
  };

  const { items: initialItems } = await middleOutFiltering(allItems);
  // usually cache was created with the last user message, so try to get at(-3) here.
  // at(-1) is usually the latest user message received, which is not cached but can also be a good cache point.
  let firstCachePoint = initialItems.length > 2 ? initialItems.length - 3 : initialItems.length - 1;
  let secondCachePoint = 0;
  const appendedItems: typeof allItems = [];

  let lastReportedTime = 0;
  while (true) {
    const items = [...initialItems, ...appendedItems];
    const { totalTokenCount, messages } = await noOpFiltering(items);
    secondCachePoint = messages.length - 1;
    [...new Set([firstCachePoint, secondCachePoint])].forEach((cp) => {
      const message = messages[cp];
      if (message?.content && enablePromptCache) {
        message.content = [...message.content, { cachePoint: { type: 'default' } }];
      }
    });
    firstCachePoint = secondCachePoint;

    const forceReport = Date.now() - lastReportedTime > 300 * 1000;

    const res = await pRetry(
      async () => {
        try {
          setKillTimer();

          const res = await bedrockConverse(['sonnet3.7'], {
            messages,
            system: [
              { text: systemPrompt },
              ...(enablePromptCache ? [{ cachePoint: { type: 'default' as const } }] : []),
            ],
            toolConfig: forceReport ? forcedReportToolConfig : toolConfig,
          });
          return res;
        } catch (e) {
          if (e instanceof ThrottlingException) {
            console.log(`retrying... ${e.message}`);
            throw e;
          }
          console.log(e);
          if (e instanceof Error) {
            throw new AbortError(e);
          }
          throw e;
        }
      },
      { retries: 100, minTimeout: 1000, maxTimeout: 5000 }
    );

    const lastItem = items.at(-1);
    if (lastItem?.role == 'user') {
      // this can be negative because reasoningContent is dropped on a new turn
      const tokenCount =
        (res.usage?.inputTokens ?? 0) +
        (res.usage?.cacheReadInputTokens ?? 0) +
        (res.usage?.cacheWriteInputTokens ?? 0) -
        totalTokenCount;
      await updateMessageTokenCount(workerId, lastItem.SK, tokenCount);
      lastItem.tokenCount = tokenCount;
    }

    console.log(JSON.stringify(res.usage));
    const outputTokenCount = res.usage?.outputTokens ?? 0;

    if (res.stopReason == 'tool_use') {
      if (res.output?.message == null) {
        throw new Error('output is null');
      }
      const toolUseMessage = res.output.message;

      const toolUse = toolUseMessage.content?.at(-1)?.toolUse;
      const toolUseId = toolUse?.toolUseId;
      if (toolUse == null || toolUseId == null) {
        throw new Error('toolUse is null');
      }
      let toolResult = '';
      let toolResultObject: ToolResultContentBlock[] | undefined = undefined;
      try {
        const name = toolUse.name;
        const toolInput = toolUse.input;
        const mcpResult = await tryExecuteMcpTool(name!, toolInput);
        if (mcpResult.found) {
          console.log(`Used MCP tool: ${name} ${JSON.stringify(toolInput)}`);
          if (typeof mcpResult.content == 'string') {
            toolResult = mcpResult.content;
          } else {
            toolResultObject = mcpResult.content!.map(
              (c): { text: string } | { image: { format: string; source: { bytes: Buffer } } } => {
                if (c.type == 'text') {
                  return {
                    text: c.text,
                  };
                } else if (c.type == 'image') {
                  return {
                    image: {
                      format: c.mimeType.split('/')[1],
                      source: { bytes: Buffer.from(c.data, 'base64') },
                    },
                  };
                } else {
                  throw new Error(`unsupported content type! ${JSON.stringify(c)}`);
                }
              }
            ) as any;
          }
        } else {
          // mcp tool for the tool name was not found.
          const tool = tools.find((tool) => tool.name == name);
          if (tool == null) {
            throw new Error(`tool ${name} is not found`);
          }
          const schema = tool.schema;
          const { success, data: input } = schema.safeParse(toolInput);
          if (!success) {
            throw new Error('invalid input');
          }

          console.log(`using tool: ${name} ${JSON.stringify(input)}`);
          toolResult = await tool.handler(input);
        }

        if (name == reportProgressTool.name) {
          lastReportedTime = Date.now();
        }
        if (name == cloneRepositoryTool.name) {
          // now that repository is determined, we try to update the system prompt
          await tryAppendRepositoryKnowledge();
        }
      } catch (e) {
        console.log(e);
        toolResult = `Error occurred when using tool ${toolUse.name}: ${(e as any).message}`;
      }

      const toolResultMessage: Message = {
        role: 'user' as const,
        content: [
          {
            toolResult: {
              toolUseId,
              content: toolResultObject ?? [
                {
                  text: toolResult,
                },
              ],
            },
          },
        ],
      };

      // Save both tool use and tool result messages atomically to DynamoDB
      // Pass response data to save token count information
      const savedItems = await saveConversationHistoryAtomic(
        workerId,
        toolUseMessage,
        toolResultMessage,
        outputTokenCount
      );
      appendedItems.push(...savedItems);
    } else {
      const finalMessage = res.output?.message;
      const mention = slackUserId ? `<@${slackUserId}> ` : '';
      if (finalMessage?.content == null || finalMessage.content?.length == 0) {
        // It seems this happens sometimes. We can just ignore this message.
        console.log('final message is empty. ignoring...');
        if (mention) {
          await sendMessage(mention);
        }
        break;
      }
      // Save assistant message with token count
      await saveConversationHistory(workerId, finalMessage, outputTokenCount, 'assistant');
      // reasoning有効の場合、content[0]には推論結果が入る
      await sendMessage(`${mention}${(finalMessage.content?.at(-1) as any)?.text}`);
      break;
    }
  }
};

export const resume = async (workerId: string) => {
  const { items } = await getConversationHistory(workerId);
  const { messages } = await middleOutFiltering(items);
  const lastMessage = messages?.at(-1);
  if (lastMessage?.role == 'user') {
    return await onMessageReceived(workerId);
  }
};
