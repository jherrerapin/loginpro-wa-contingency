import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

export async function uploadBufferToR2(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
}

export async function getSignedDownloadUrl(key) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}
