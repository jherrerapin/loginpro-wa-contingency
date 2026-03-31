// Importa Express para crear el router del panel administrativo.
import express from 'express';

// Middleware de autenticación básica para proteger el dashboard sin montar un sistema de usuarios más complejo.
function basicAuth(req, res, next) {
  // Lee la cabecera Authorization o usa una cadena vacía si no existe.
  const header = req.headers.authorization || '';

  // Separa el tipo de autenticación y el token base64.
  const [type, token] = header.split(' ');

  // Valida que el tipo sea Basic y que exista token.
  if (type !== 'Basic' || !token) {
    // Informa al navegador que se requiere autenticación.
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');

    // Responde con estado 401.
    return res.status(401).send('Authentication required');
  }

  // Decodifica el token base64 a la forma usuario:clave.
  const [user, pass] = Buffer.from(token, 'base64').toString('utf8').split(':');

  // Valida usuario y contraseña contra variables de entorno.
  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    // Informa al navegador que la autenticación volvió a fallar.
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');

    // Responde con estado 401 por credenciales inválidas.
    return res.status(401).send('Invalid credentials');
  }

  // Si todo es correcto, continúa al siguiente middleware o controlador.
  next();
}

// Formatea fechas para el dashboard en zona horaria de Colombia (Bogotá) sin alterar almacenamiento.
function formatDateTimeCO(value) {
  // Evita errores cuando no hay fecha disponible.
  if (!value) {
    return '';
  }

  // Convierte a Date y valida que sea una fecha válida.
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  // Renderiza con configuración regional de Colombia y hora de Bogotá.
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
  // Crea una nueva instancia de router.
  const router = express.Router();

  // Protege todas las rutas del dashboard con autenticación básica.
  router.use(basicAuth);

  // Ruta principal del panel para listar candidatos recientes.
  router.get('/', async (_req, res) => {
    // Consulta hasta 200 candidatos ordenados por fecha descendente.
    const candidates = await prisma.candidate.findMany({
      // Ordena por fecha de creación más reciente primero.
      orderBy: { createdAt: 'desc' },
      // Limita el resultado para mantener el panel liviano.
      take: 200
    });

    // Renderiza la vista de listado.
    res.render('list', { candidates, formatDateTimeCO });
  });

  // Ruta de detalle de un candidato específico.
  router.get('/candidates/:id', async (req, res) => {
    // Consulta el candidato por id e incluye sus últimos mensajes.
    const candidate = await prisma.candidate.findUnique({
      // Busca el candidato por el parámetro de ruta.
      where: { id: req.params.id },
      // Incluye mensajes recientes para auditoría operativa.
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50
        }
      }
    });

    // Si el candidato no existe, responde 404.
    if (!candidate) {
      return res.status(404).send('Candidate not found');
    }

    // Renderiza la vista de detalle.
    res.render('detail', { candidate, formatDateTimeCO });
  });

  // Ruta para actualizar el estado del candidato desde el panel.
  router.post('/candidates/:id/status', express.urlencoded({ extended: true }), async (req, res) => {
    // Actualiza el estado del candidato usando el valor enviado por el formulario.
    await prisma.candidate.update({
      // Busca el candidato por id.
      where: { id: req.params.id },
      // Actualiza solo el estado.
      data: { status: req.body.status }
    });

    // Redirige de vuelta al detalle del candidato.
    res.redirect(`/admin/candidates/${req.params.id}`);
  });

  // Ruta para descargar la hoja de vida almacenada directamente en PostgreSQL.
  router.get('/candidates/:id/cv', async (req, res) => {
    // Consulta el candidato por id.
    const candidate = await prisma.candidate.findUnique({
      // Busca el candidato por id.
      where: { id: req.params.id }
    });

    // Si el candidato no existe o no tiene CV cargado, responde 404.
    if (!candidate?.cvData) {
      return res.status(404).send('CV not found');
    }

    // Define el tipo de contenido del archivo.
    res.setHeader('Content-Type', candidate.cvMimeType || 'application/octet-stream');

    // Define el nombre del archivo que descargará el navegador.
    res.setHeader('Content-Disposition', `attachment; filename="${candidate.cvOriginalName || 'cv'}"`);

    // Envía el binario del CV al navegador.
    return res.send(Buffer.from(candidate.cvData));
  });

  // Retorna el router listo para montarse en /admin.
  return router;
}
