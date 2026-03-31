import express from 'express';
import { getSignedDownloadUrl } from '../services/storage.js';

function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Basic' || !token) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }

  const [user, pass] = Buffer.from(token, 'base64').toString('utf8').split(':');
  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Invalid credentials');
  }

  next();
}

export function adminRouter(prisma) {
  const router = express.Router();
  router.use(basicAuth);

  router.get('/', async (_req, res) => {
    const candidates = await prisma.candidate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.render('list', { candidates });
  });

  router.get('/candidates/:id', async (req, res) => {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 50 } }
    });

    if (!candidate) return res.status(404).send('Candidate not found');
    res.render('detail', { candidate });
  });

  router.post('/candidates/:id/status', express.urlencoded({ extended: true }), async (req, res) => {
    await prisma.candidate.update({
      where: { id: req.params.id },
      data: { status: req.body.status }
    });
    res.redirect(`/admin/candidates/${req.params.id}`);
  });

  router.get('/candidates/:id/cv', async (req, res) => {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate?.cvStorageKey) return res.status(404).send('CV not found');
    const signedUrl = await getSignedDownloadUrl(candidate.cvStorageKey);
    res.redirect(signedUrl);
  });

  return router;
}
