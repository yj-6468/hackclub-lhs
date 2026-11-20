const { createHash, randomUUID } = require('node:crypto');
const blob = require('@vercel/blob');

const MAX_PDF_BYTES = 30_000_000;
const MAX_PDFS = 10;
const PDF_TYPE = 'application/pdf';
const PREFIX = 'clubhelper-pdf/v1/';
const RETENTION_MS = 60 * 60 * 1000;

function validPDFSizes(sizes) {
  return Array.isArray(sizes) && sizes.length > 0 && sizes.length <= MAX_PDFS &&
    sizes.every(size => Number.isSafeInteger(size) && size >= 5) &&
    sizes.reduce((total, size) => total + size, 0) <= MAX_PDF_BYTES;
}

function memberPrefix(id) {
  return PREFIX + createHash('sha256').update(id).digest('hex') + '/';
}

function validPDFUpload(upload, userId) {
  const prefix = memberPrefix(userId);
  return typeof upload?.path === 'string' && upload.path.startsWith(prefix) &&
    /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.pdf$/.test(upload.path.slice(prefix.length)) &&
    validPDFSizes([upload.size]);
}

function createPDFStore(env, sdk = blob) {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token || !env.CRON_SECRET?.trim()) return null;

  return {
    async sign(userId, sizes) {
      return Promise.all(sizes.map(async size => {
        const path = `${memberPrefix(userId)}${randomUUID()}.pdf`;
        const constraints = {
          pathname: path,
          validUntil: Date.now() + 5 * 60 * 1000,
          allowedContentTypes: [PDF_TYPE],
          maximumSizeInBytes: size
        };
        const signed = await sdk.issueSignedToken({ ...constraints, token, operations: ['put'],
          abortSignal: AbortSignal.timeout(15000) });
        const { presignedUrl } = await sdk.presignUrl(signed, {
          ...constraints, operation: 'put', access: 'private', addRandomSuffix: false,
          allowOverwrite: false, cacheControlMaxAge: 60
        });
        return { path, size, url: presignedUrl };
      }));
    },
    async read({ path, size }) {
      const result = await sdk.get(path, { token, access: 'private', useCache: false,
        abortSignal: AbortSignal.timeout(30000) });
      if (result?.statusCode !== 200) return null;
      if (result.blob.size !== size || result.blob.contentType !== PDF_TYPE) {
        await result.stream.cancel();
        return null;
      }
      const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
      return bytes.length === size && bytes.subarray(0, 5).toString('latin1') === '%PDF-'
        ? bytes.toString('base64') : null;
    },
    async clean(now) {
      let cursor;
      do {
        const page = await sdk.list({ token, prefix: PREFIX, cursor, limit: 1000 });
        const expired = page.blobs.filter(item => item.uploadedAt.getTime() <= now - RETENTION_MS);
        if (expired.length) await sdk.del(expired.map(item => item.pathname), { token });
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    }
  };
}

module.exports = { createPDFStore, validPDFSizes, validPDFUpload, MAX_PDF_BYTES, MAX_PDFS, PDF_TYPE };
