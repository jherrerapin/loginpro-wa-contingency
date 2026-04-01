// Importa Express para crear el router del panel administrativo.
import express from 'express';

// Middleware de autenticación básica para proteger el dashboard.
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

// Formatea fechas para el dashboard en zona horaria de Colombia (Bogotá).
function formatDateTimeCO(value) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

// Expone el router administrativo.
export function adminRouter(prisma) {
  const router = express.Router();

  // Protege todas las rutas del dashboard con autenticación básica.
  router.use(basicAuth);

  // Ruta principal: listado de candidatos.
  router.get('/', async (_req, res) => {
    const candidates = await prisma.candidate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.render('list', { candidates, formatDateTimeCO });
  });

  // Ruta de detalle de un candidato con historial de mensajes.
  router.get('/candidates/:id', async (req, res) => {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50
        }
      }
    });

    if (!candidate) {
      return res.status(404).send('Candidato no encontrado');
    }

    res.render('detail', { candidate, formatDateTimeCO });
  });

  // Ruta para actualizar el estado del candidato desde el panel.
  router.post('/candidates/:id/status', express.urlencoded({ extended: true }), async (req, res) => {
    await prisma.candidate.update({
      where: { id: req.params.id },
      data: { status: req.body.status }
    });
    res.redirect(`/admin/candidates/${req.params.id}`);
  });

  return router;
}
