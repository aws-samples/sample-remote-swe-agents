import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export const s3 = new S3Client();
export const BucketName = process.env.BUCKET_NAME!;

export const getBytesFromKey = async (key: string) => {
  const { Body } = await s3.send(
    new GetObjectCommand({
      Bucket: BucketName,
      Key: key,
    })
  );
  return Body!.transformToByteArray();
};

export const writeBytesToKey = async (key: string, bytes: Uint8Array) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: BucketName,
      Key: key,
      Body: bytes,
    })
  );
};
