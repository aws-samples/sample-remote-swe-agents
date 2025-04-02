import { ConverseCommandInput, ThrottlingException } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import pRetry, { AbortError } from 'p-retry';
import { setKillTimer } from '../../../common/kill-timer';
import { Screen } from './screen';
import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { bedrockConverse } from '../../common/bedrock';

const inputSchema = z.object({
  url: z.string().describe('URL to the web page you want to browse.'),
  query: z
    .string()
    .describe('User query. For example, what the user wants to know from the information in the web page.'),
});

export const browseWebPage = async (input: z.infer<typeof inputSchema>) => {
  const systemPrompt = `Browse web pages and answer the query from the user. Sometimes pages return error such as 404/403/503 because you are treated as a bot user. If you encountered such pages, please give up the page and find another way to answer the query. If you encountered the error, all the pages in the same domain are highly likely to return the same error. So you should avoid to access the domain itself.

IMPORTANT:
- DO NOT USE your own knowledge to answer the query. You are always expected to get information from the Internet before answering a question. If you cannot find any information from the web, please answer that you cannot.
- DO NOT make up any urls by yourself because it is unreliable. Instead, use search engines such as https://www.google.com/search?q=QUERY or https://www.bing.com/search?q=QUERY
- You should always consider to use ScrapeUrlToMarkdown tool instead of computer use because of its efficiency. When you get a URL while using computer use, please try to scrape the url first.
- ScrapeUrlToMarkdown tool truncates the output when the html is too long. If you find important content is truncated, use computer use tool instead to browse the content.
- Some pages can be inaccessible due to permission issues or bot protection. If you encountered these, just returns a message "I cannot access to the page due to REASON...". DO NOT make up any information guessing from the URL.
`;
  const width = 800;
  const height = 800;
  const screen = await Screen.init(height, width);
  await screen.goto(input.url);
  await screen.mouseMove(100, 100);
  const messages: ConverseCommandInput['messages'] = [
    {
      role: 'user',
      content: [
        {
          text: `${input.query}\nYou are currently browsing ${input.url}. The current browser screen shot is also provided here.`,
        },
        {
          image: {
            format: 'png',
            source: {
              bytes: await screen.screenshot(),
            },
          },
        },
      ],
    },
  ];
  let firstCachePoint = 0;
  let secondCachePoint = 0;
  while (true) {
    // set cache points
    secondCachePoint = messages.length - 1;
    [firstCachePoint, secondCachePoint].forEach((cp) => {
      const message = messages[cp];
      if (message?.content) {
        message.content = [...message.content, { cachePoint: { type: 'default' } }];
      }
    });

    const res = await pRetry(
      async () => {
        try {
          setKillTimer();

          const res = await bedrockConverse(
            // we can use computer_20250124 tool with sonnet 3.7 only!
            ['sonnet3.7'],
            {
              messages,
              system: [{ text: systemPrompt }, { cachePoint: { type: 'default' } }],
              additionalModelRequestFields: {
                tools: [
                  {
                    type: 'computer_20250124',
                    name: 'computer',
                    display_height_px: height,
                    display_width_px: width,
                    display_number: 0,
                  },
                ],
                anthropic_beta: ['computer-use-2025-01-24'],
              },
              toolConfig: {
                tools: [
                  {
                    toolSpec: {
                      name: 'NavigateToUrl',
                      description: `Navigate to the specified URL for computer use's screen.
IMPORTANT:
This only take effect for the screen in computer use tool. If you just want to scrape content from a url, use ScrapeUrlToMarkdown tool directly.`,
                      inputSchema: {
                        json: {
                          type: 'object',
                          properties: {
                            url: {
                              type: 'string',
                              description: 'URL to navigate to.',
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    toolSpec: {
                      name: 'ScrapeUrlToMarkdown',
                      description: `This tool fetches HTML from the web page, and convert it to markdown. Use this tool first to check the page content. If the content length is too large, this tool truncates the content. In the bottom of the content, you will get the size of original page and how much information was truncated.
IMPORTANT: In the below cases, use computer-use tool instead to visually inspect the page: 
- When important content is apparently truncated.
- When you want to interact with elements in the page, for example, clicking a button or filling a form.
- When you want to visually check the page content, for example, DOM analysis or image.
`,
                      inputSchema: {
                        json: {
                          type: 'object',
                          properties: {
                            url: {
                              type: 'string',
                              description: 'URL to scrape.',
                            },
                          },
                        },
                      },
                    },
                  },
                  { cachePoint: { type: 'default' } },
                ],
              },
            }
          );
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
        } finally {
        }
      },
      { retries: 10, minTimeout: 3000, maxTimeout: 20000 }
    );
    // remove cachePoints
    [firstCachePoint, secondCachePoint].forEach((cp) => {
      const message = messages[cp];
      if ('cachePoint' in (message?.content?.at(-1) ?? {})) {
        message.content!.pop();
      }
    });
    firstCachePoint = secondCachePoint;

    console.log(JSON.stringify(res.usage));
    if (res.stopReason == 'tool_use') {
      if (res.output?.message == null) {
        throw new Error('output is null');
      }
      messages.push(res.output.message);

      const toolUse = res.output.message.content?.at(-1)?.toolUse;
      const toolUseId = toolUse?.toolUseId;
      if (toolUse == null || toolUseId == null) {
        throw new Error('toolUse is null');
      }
      console.log(`using tool ${JSON.stringify(toolUse)}`);
      let toolResult = '';
      let screenShot = undefined;
      try {
        switch (toolUse.name) {
          case 'computer': {
            const schema = z.object({
              action: z.enum([
                'key',
                'hold_key',
                'type',
                'cursor_position',
                'mouse_move',
                'left_mouse_down',
                'left_mouse_up',
                'left_click',
                'left_click_drag',
                'right_click',
                'middle_click',
                'double_click',
                'triple_click',
                'scroll',
                'wait',
                'screenshot',
              ]),
              coordinate: z.array(z.number().int()).length(2).optional(),
              duration: z.number().int().optional(),
              scroll_amount: z.number().int().optional(),
              scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
              start_coordinate: z.array(z.number()).optional(),
              text: z.string().optional(),
            });
            const { success, data: input } = schema.safeParse(toolUse.input);
            if (!success) {
              throw new Error('invalid input');
            }
            switch (input.action) {
              case 'key': {
                await screen.key(input.text!);
                break;
              }
              case 'hold_key': {
                await screen.holdKey(input.text!, input.duration!);
                break;
              }
              case 'type': {
                await screen.type(input.text!);
                break;
              }
              case 'cursor_position': {
                const { x, y } = await screen.cursorPosition();
                toolResult = `x: ${x}, y: ${y}`;
                break;
              }
              case 'mouse_move': {
                await screen.mouseMove(input.coordinate![0], input.coordinate![1]);
                break;
              }
              case 'left_mouse_down': {
                await screen.leftMouseDown();
                break;
              }
              case 'left_mouse_up': {
                await screen.leftMouseUp();
                break;
              }
              case 'left_click': {
                await screen.leftClick(input.coordinate![0], input.coordinate![1]);
                break;
              }
              case 'left_click_drag': {
                await screen.leftClickDrag(
                  input.start_coordinate![0],
                  input.start_coordinate![1],
                  input.coordinate![0],
                  input.coordinate![1]
                );
                break;
              }
              case 'right_click': {
                await screen.rightClick();
                break;
              }
              case 'middle_click': {
                await screen.middleClick();
                break;
              }
              case 'double_click': {
                await screen.doubleClick();
                break;
              }
              case 'triple_click': {
                await screen.tripleClick(input.coordinate![0], input.coordinate![1]);
                break;
              }
              case 'scroll': {
                await screen.scroll(
                  input.coordinate![0],
                  input.coordinate![1],
                  input.scroll_direction!,
                  input.scroll_amount!
                );
                break;
              }
              case 'wait': {
                await screen.wait(input.duration!);
                break;
              }
              case 'screenshot': {
                screenShot = await screen.screenshot();
                break;
              }
            }
            toolResult += `\nCurrent Url: ${await screen.getCurrentUrl()}`;
            break;
          }
          case 'NavigateToUrl': {
            const schema = z.object({
              url: z.string(),
            });
            const { success, data: input } = schema.safeParse(toolUse.input);
            if (!success) {
              throw new Error('invalid input');
            }
            await screen.goto(input.url);
            toolResult = `successfully navigated to ${input.url}`;
            break;
          }
          case 'ScrapeUrlToMarkdown': {
            const schema = z.object({
              url: z.string(),
            });
            const { success, data: input } = schema.safeParse(toolUse.input);
            if (!success) {
              throw new Error('invalid input');
            }
            const res = await screen.scrapeWebpage(input.url);
            toolResult = res.markdown;
            break;
          }
        }
      } catch (e) {
        console.log(e);
        toolResult = `Error occurred when using tool ${toolUse.name}: ${(e as any).message}`;
      }

      messages.push({
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId,
              content: [
                screenShot != null
                  ? {
                      image: {
                        format: 'png',
                        source: {
                          bytes: screenShot,
                        },
                      },
                    }
                  : {
                      text: toolResult,
                    },
              ],
            },
          },
        ],
      });
    } else {
      if (res.output?.message == null) {
        throw new Error('output is null');
      }
      messages.push(res.output.message);
      break;
    }
  }

  const result = `${(messages.at(-1)?.content?.[0] as any)?.text}`;
  console.log(result);

  await screen.close();
  return result;
};

const name = 'webBrowserTool';

export const webBrowserTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: browseWebPage,
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `You can browse a web page using this tool. You can extract information from the page, or execute some tasks by navigating the pages.

IMPORTANT:
- DO NOT use this tool for GitHub URL (https://github.com/...). Instead, DO use GitHub CLI via ExecuteCommandTool to efficiently get the information.
`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};

// browseWebPage({
//   url: 'https://news.ycombinator.com/news',
//   query: '最新のニュースをコメント欄も含めて3件要約してください',
// });
