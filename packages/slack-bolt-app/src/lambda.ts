import { receiver } from './app';

export const handler = async (event: any, context: any, callback: any) => {
  const handler = await receiver.start();
  console.log(JSON.stringify(event));
  return handler(event, context, callback);
};
