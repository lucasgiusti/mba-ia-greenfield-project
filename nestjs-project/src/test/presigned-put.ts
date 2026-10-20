import { request, type IncomingMessage } from 'node:http';

export interface PresignedPutResult {
  status: number;
  etag: string | undefined;
}

/**
 * PUTs a body to a presigned URL signed for STORAGE_PUBLIC_ENDPOINT (the
 * browser host, unreachable from inside a container). The TCP connection goes
 * to STORAGE_ENDPOINT (Compose service name) while the original Host header is
 * kept, so the SigV4 signature of the URL handed to the client stays valid.
 */
export async function putToPresignedUrl(
  presignedUrl: string,
  body: Buffer,
): Promise<PresignedPutResult> {
  const target = new URL(presignedUrl);
  const internal = new URL(process.env.STORAGE_ENDPOINT ?? 'http://minio:9000');

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'PUT',
        hostname: internal.hostname,
        port: internal.port,
        path: `${target.pathname}${target.search}`,
        headers: { Host: target.host, 'Content-Length': body.length },
      },
      (res: IncomingMessage) => {
        res.resume();
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            etag: res.headers['etag'],
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
