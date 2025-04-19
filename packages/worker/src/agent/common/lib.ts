import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type ToolDefinition<Input> = {
  name: string;
  handler: (input: Input) => Promise<string>;
  schema: ZodSchema;
  toolSpec: () => Promise<NonNullable<Tool['toolSpec']>>;
};

export const zodToJsonSchemaBody = (schema: ZodSchema) => {
  const key = 'mySchema';
  const jsonSchema = zodToJsonSchema(schema, key);
  return jsonSchema.definitions?.[key] as any;
};

export const truncate = (str: string, maxLength: number = 10 * 1e3, headRatio = 0.2) => {
  if (str.length < maxLength) return str;
  if (headRatio < 0 || headRatio > 1) throw new Error('headRatio must be between 0 and 1');

  const first = str.slice(0, maxLength * headRatio);
  const last = str.slice(-maxLength * (1 - headRatio));
  return first + '\n..(truncated)..\n' + last + `\n// Output was truncated. Original length: ${str.length} characters.`;
};
