import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const inputSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to modify (must be absolute, not relative)'),
  oldString: z
    .string()
    .describe(
      'The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)'
    ),
  newString: z.string().describe('The edited text to replace the oldString'),
});

const name = 'fileEditor';

const editFile = async (input: z.infer<typeof inputSchema>) => {
  const { filePath, oldString, newString } = input;
  if (existsSync(filePath) === false) {
    if (oldString) {
      return `The file does not exist. Please check again.`;
    }
    writeFileSync(filePath, newString);
    return 'successfully created the file.';
  }

  const fileContents = readFileSync(filePath, 'utf8');

  const isValid = isSingleOccurrence(fileContents, oldString);
  if (isValid == undefined) {
    return `The file does not contain the oldString. Please check again.`;
  } else if (!isValid) {
    return `The file contains multiple occurrences of the oldString. Only one occurrence is allowed.`;
  }

  const updatedContents = fileContents.replace(oldString, newString);
  writeFileSync(filePath, updatedContents);
  return 'successfully edited the file.';
};

const isSingleOccurrence = (str: string, substr: string) => {
  const first = str.indexOf(substr);
  if (first == -1) return;
  const last = str.lastIndexOf(substr);
  return first == last;
};

export const fileEditTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: editFile,
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `
This tool edits files. For moving/renaming, use the Bash tool with 'mv' instead.

Before using:
1. Use cat to understand file contents/context
2. For new files: verify directory path with ls command

The tool replaces ONE occurrence of oldString with newString.

CRITICAL REQUIREMENTS:

1. UNIQUENESS: oldString must uniquely identify the change:
   - Include 3-5 lines before change
   - Include 3-5 lines after change
   - Match whitespace/indentation exactly

2. SINGLE INSTANCE: One change per call:
   - Separate calls for multiple instances
   - Each needs unique context

3. VERIFY FIRST:
   - Check instance count
   - Gather context for multiple instances
   - Plan separate calls

WARNINGS:
- Fails on multiple matches
- Fails on inexact matches
- Wrong changes if context insufficient

Best Practices:
- Write idiomatic, working code
- Don't break code
- Use absolute paths
- For new files: empty oldString, contents as newString
- Bundle multiple edits to same file in one message
`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
