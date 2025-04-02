import {
  ConverseCommandInput,
  ConverseRequest,
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
import { readMetadata } from './common/metadata';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

export const onMessageReceived = async (workerId: string) => {
  const { items: allItems } = await pRetry(
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

  // Base system prompt
  const baseSystemPrompt = `You are an SWE agent. Help your user using your software development skill. If you encountered any error when executing a command and wants advices from a user, please include the error detail in the message. Always use the same language that user speaks.

Here are some information you should know (DO NOT share this information with the user):
- Your current working directory is ${DefaultWorkingDirectory}
- You are running on an Amazon EC2 instance. You can get the instance metadata from IMDSv2 endpoint.
- Today is ${new Date().toDateString()}.

## Communication Style
Be brief, clear, and precise. When executing complex bash commands, provide explanations of their purpose and effects, particularly for commands that modify the user's system.
Your responses will appear in a command-line interface. Format using Github-flavored markdown, which will render in monospace font following CommonMark specifications.
Communicate with the user through text output; all non-tool text is visible to users. Use tools exclusively for task completion. Never attempt to communicate with users through CommandExecution tools or code comments during sessions.
If you must decline a request, avoid explaining restrictions or potential consequences as this can appear condescending. Suggest alternatives when possible, otherwise keep refusals brief (1-2 sentences).
CRITICAL: Minimize token usage while maintaining effectiveness, quality and precision. Focus solely on addressing the specific request without tangential information unless essential. When possible, respond in 1-3 sentences or a concise paragraph.
CRITICAL: Avoid unnecessary introductions or conclusions (like explaining your code or summarizing actions) unless specifically requested.
CRITICAL: Keep responses compact for command-line display. Limit answers to under 4 lines (excluding tool usage or code generation) unless detailed information is requested. Answer questions directly without elaboration. Single-word answers are preferable. Avoid introductory or concluding phrases like "The answer is..." or "Based on the information provided...". Examples:
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
1. Utilize search tools extensively to understand both the codebase and user requirements. Use search tools both in parallel and sequential patterns.
2. Implement solutions using all available tools
3. Verify solutions with tests when possible. NEVER assume specific testing frameworks or scripts. Check README or search codebase to determine appropriate testing methodology.
4. ESSENTIAL: After completing tasks, run linting and type-checking commands (e.g., npm run lint, npm run typecheck, ruff, etc.) if available to verify code correctness. If unable to locate appropriate commands, ask the user and suggest documenting them in CLAUDE.md for future reference.
5. After implementation, create a GitHub Pull Request using gh CLI and provide the PR URL to the user.
`;

  let systemPrompt = baseSystemPrompt;

  const tryAppendRepositoryKnowledge = async () => {
    try {
      // Get metadata from DynamoDB
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
    fileEditTool,
    webBrowserTool,
    sendImageTool,
  ];
  const toolConfig: ConverseCommandInput['toolConfig'] = {
    tools: [
      ...(await Promise.all(tools.map(async (tool) => ({ toolSpec: await tool.toolSpec() })))),
      ...(await getMcpToolSpecs()),
      { cachePoint: { type: 'default' } },
    ],
  };

  const { items: initialItems } = await middleOutFiltering(allItems);
  // usually cache was created with the last assistant message, so try to get at(-2) here.
  // at(-1) is usually the latest user message received, which is not cached but can also be a good cache point.
  let firstCachePoint = initialItems.length <= 1 ? initialItems.length - 1 : initialItems.length - 2;
  let secondCachePoint = 0;
  const appendedItems: typeof allItems = [];

  let lastReportedTime = Date.now() - 300 * 1000;
  while (true) {
    const items = [...initialItems, ...appendedItems];
    const { totalTokenCount, messages } = await noOpFiltering(items);
    secondCachePoint = messages.length - 1;
    [firstCachePoint, secondCachePoint].forEach((cp) => {
      const message = messages[cp];
      if (message?.content) {
        message.content = [...message.content, { cachePoint: { type: 'default' } }];
      }
    });
    console.log(JSON.stringify(messages));
    firstCachePoint = secondCachePoint;

    const res = await pRetry(
      async () => {
        try {
          setKillTimer();

          const res = await bedrockConverse(['sonnet3.7'], {
            messages,
            system: [{ text: systemPrompt }, { cachePoint: { type: 'default' } }],
            toolConfig,
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
      // this can be negative because reasoningContent is dropped on new turn
      const tokenCount = (res.usage?.inputTokens ?? 0) + (res.usage?.cacheReadInputTokens ?? 0) - totalTokenCount;
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
          lastReportedTime = Date.now(); // reset timer
        }
        if (name == cloneRepositoryTool.name) {
          // now that repository is determined, we try to update the system prompt
          await tryAppendRepositoryKnowledge();
        }
      } catch (e) {
        console.log(e);
        toolResult = `Error occurred when using tool ${toolUse.name}: ${(e as any).message}`;
      }

      toolResult += `\nElapsed time since the last message to the user: ${Math.round((Date.now() - lastReportedTime) / 1000)} seconds.`;
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
      if (finalMessage?.content == null || finalMessage.content?.length == 0) {
        // It seems this happens sometimes. We can just ignore this message.
        break;
      }
      // Save assistant message with token count
      await saveConversationHistory(workerId, finalMessage, outputTokenCount, 'assistant');
      // reasoning有効の場合、content[0]には推論結果が入る
      await sendMessage(`${(finalMessage.content?.at(-1) as any)?.text}`);
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
